use crate::ids::Rev;
use crate::protocol::{HostState, SyncCursor};
use serde::{Deserialize, Serialize};

/// What a client must do to catch up with a host.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum SyncAction {
    UpToDate,
    FetchChanges { since: Rev },
    Resnapshot { reason: ResnapshotReason },
}

/// Why the changes since the client's rev can't bring it up to date.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResnapshotReason {
    /// The client has never synced with this host.
    NeverSynced,
    /// The client's copy is of another library.
    DifferentLibrary,
    /// The client has seen revs the host doesn't have: the host was restored
    /// from an older copy of the same library.
    ClientAhead,
    /// The host no longer has every change after the client's rev.
    Compacted,
}

/// Decides how `client` (`None` when it has never synced) catches up with
/// `host`. Hosts run it on every changes request, so a client that asks for
/// changes it can't apply is told to resnapshot instead.
pub fn plan_sync(client: Option<&SyncCursor>, host: &HostState) -> SyncAction {
    let resnapshot = |reason| SyncAction::Resnapshot { reason };
    let Some(client) = client else {
        return resnapshot(ResnapshotReason::NeverSynced);
    };
    if client.library_id != host.library_id {
        return resnapshot(ResnapshotReason::DifferentLibrary);
    }
    if client.rev > host.rev {
        return resnapshot(ResnapshotReason::ClientAhead);
    }
    if client.rev < host.oldest_rev {
        return resnapshot(ResnapshotReason::Compacted);
    }
    if client.rev == host.rev {
        SyncAction::UpToDate
    } else {
        SyncAction::FetchChanges { since: client.rev }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::LibraryId;

    fn host(rev: u64, oldest_rev: u64) -> HostState {
        HostState {
            library_id: LibraryId::new("lib-a"),
            rev: Rev(rev),
            oldest_rev: Rev(oldest_rev),
        }
    }

    fn cursor(library: &str, rev: u64) -> SyncCursor {
        SyncCursor {
            library_id: LibraryId::new(library),
            rev: Rev(rev),
        }
    }

    fn resnapshot(reason: ResnapshotReason) -> SyncAction {
        SyncAction::Resnapshot { reason }
    }

    #[test]
    fn a_client_that_never_synced_takes_a_snapshot() {
        assert_eq!(
            plan_sync(None, &host(0, 0)),
            resnapshot(ResnapshotReason::NeverSynced)
        );
        assert_eq!(
            plan_sync(None, &host(42, 0)),
            resnapshot(ResnapshotReason::NeverSynced)
        );
    }

    #[test]
    fn another_library_takes_a_snapshot_whatever_the_revs() {
        for rev in [0, 5, 10, 11] {
            assert_eq!(
                plan_sync(Some(&cursor("lib-b", rev)), &host(10, 0)),
                resnapshot(ResnapshotReason::DifferentLibrary),
                "client rev {rev}"
            );
        }
    }

    #[test]
    fn a_client_ahead_of_a_restored_host_takes_a_snapshot() {
        assert_eq!(
            plan_sync(Some(&cursor("lib-a", 11)), &host(10, 0)),
            resnapshot(ResnapshotReason::ClientAhead)
        );
        assert_eq!(
            plan_sync(Some(&cursor("lib-a", 1)), &host(0, 0)),
            resnapshot(ResnapshotReason::ClientAhead)
        );
    }

    #[test]
    fn a_client_behind_compaction_takes_a_snapshot() {
        assert_eq!(
            plan_sync(Some(&cursor("lib-a", 4)), &host(10, 5)),
            resnapshot(ResnapshotReason::Compacted)
        );
        // `oldest_rev` itself can still be answered.
        assert_eq!(
            plan_sync(Some(&cursor("lib-a", 5)), &host(10, 5)),
            SyncAction::FetchChanges { since: Rev(5) }
        );
    }

    #[test]
    fn a_client_at_the_host_rev_is_up_to_date() {
        assert_eq!(
            plan_sync(Some(&cursor("lib-a", 10)), &host(10, 0)),
            SyncAction::UpToDate
        );
        assert_eq!(
            plan_sync(Some(&cursor("lib-a", 0)), &host(0, 0)),
            SyncAction::UpToDate
        );
    }

    #[test]
    fn a_client_behind_fetches_changes_since_its_rev() {
        assert_eq!(
            plan_sync(Some(&cursor("lib-a", 0)), &host(10, 0)),
            SyncAction::FetchChanges { since: Rev(0) }
        );
        assert_eq!(
            plan_sync(Some(&cursor("lib-a", 9)), &host(10, 0)),
            SyncAction::FetchChanges { since: Rev(9) }
        );
    }
}
