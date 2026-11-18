//! The user's region (ISO 3166-1 alpha-2), read from the OS locale, used to
//! prefer MusicBrainz releases issued in their country.

use crate::musicbrainz_disc::DiscMetadata;
use crate::musicbrainz_entity::MusicBrainzEntityHit;

/// MusicBrainz's code for a release issued worldwide.
const WORLDWIDE: &str = "XW";
/// MusicBrainz's code for a release issued across Europe.
const EUROPE: &str = "XE";

/// Anything carrying a MusicBrainz release `country` code and release year.
pub trait HasCountry {
    fn country_code(&self) -> Option<&str>;
    fn release_year(&self) -> Option<i32>;
}

impl HasCountry for DiscMetadata {
    fn country_code(&self) -> Option<&str> {
        self.country.as_deref()
    }

    fn release_year(&self) -> Option<i32> {
        self.year
    }
}

impl HasCountry for MusicBrainzEntityHit {
    fn country_code(&self) -> Option<&str> {
        self.country.as_deref()
    }

    fn release_year(&self) -> Option<i32> {
        self.year
    }
}

/// The OS region, e.g. `GB` for `en-GB`. `None` when the locale has no region subtag.
pub fn system_country() -> Option<String> {
    sys_locale::get_locale().and_then(|locale| country_from_locale(&locale))
}

/// Pulls the region subtag out of a BCP-47 / POSIX locale tag.
/// `en-GB`, `en_GB`, `en_GB.UTF-8`, `zh-Hant-TW` -> the 2-letter region; `en` -> `None`.
pub fn country_from_locale(locale: &str) -> Option<String> {
    let tag = locale.split(['.', '@']).next().unwrap_or(locale);
    tag.split(['-', '_'])
        .skip(1)
        .find(|part| part.len() == 2 && part.chars().all(|c| c.is_ascii_alphabetic()))
        .map(str::to_ascii_uppercase)
}

/// Stable sort: the user's country first, then worldwide (`XW`), then Europe-wide (`XE`),
/// then every other single country. With no known country, `XW` and `XE` still outrank
/// single-country releases. Within each group, oldest year first; releases with no year go last.
pub fn sort_by_country<T: HasCountry>(items: &mut [T], country: Option<&str>) {
    items.sort_by_key(|item| {
        let tier = match item.country_code().map(str::to_ascii_uppercase).as_deref() {
            Some(code) if country.is_some_and(|c| c.eq_ignore_ascii_case(code)) => 0,
            Some(WORLDWIDE) => 1,
            Some(EUROPE) => 2,
            _ => 3,
        };
        (tier, item.release_year().unwrap_or(i32::MAX))
    });
}

/// [`sort_by_country`] using the OS region.
pub fn sort_by_system_country<T: HasCountry>(items: &mut [T]) {
    sort_by_country(items, system_country().as_deref());
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate(mbid: &str, country: Option<&str>) -> DiscMetadata {
        DiscMetadata {
            disc_id: None,
            album: None,
            album_artist: None,
            year: None,
            genre: None,
            country: country.map(str::to_string),
            label: None,
            release_mbid: Some(mbid.to_string()),
            album_artist_mbids: Vec::new(),
            tracks: Vec::new(),
        }
    }

    fn order(candidates: &[DiscMetadata]) -> Vec<&str> {
        candidates
            .iter()
            .filter_map(|c| c.release_mbid.as_deref())
            .collect()
    }

    #[test]
    fn parses_region_from_locale_tags() {
        assert_eq!(country_from_locale("en-GB").as_deref(), Some("GB"));
        assert_eq!(country_from_locale("en_gb").as_deref(), Some("GB"));
        assert_eq!(country_from_locale("de_DE.UTF-8").as_deref(), Some("DE"));
        assert_eq!(country_from_locale("zh-Hant-TW").as_deref(), Some("TW"));
        assert_eq!(country_from_locale("en"), None);
        assert_eq!(country_from_locale("es-419"), None);
        assert_eq!(country_from_locale(""), None);
    }

    #[test]
    fn sorts_user_country_then_worldwide_then_rest_stably() {
        let mut list = vec![
            candidate("za", Some("ZA")),
            candidate("xe", Some("XE")),
            candidate("jp", Some("JP")),
            candidate("xw", Some("XW")),
            candidate("us1", Some("US")),
            candidate("none", None),
            candidate("us2", Some("us")),
        ];
        sort_by_country(&mut list, Some("US"));
        assert_eq!(order(&list), ["us1", "us2", "xw", "xe", "za", "jp", "none"]);
    }

    #[test]
    fn sorts_oldest_first_within_a_group_with_missing_years_last() {
        let mut list = vec![
            candidate("us-2003", Some("US")),
            candidate("us-none", Some("US")),
            candidate("us-1998", Some("US")),
            candidate("za-1990", Some("ZA")),
            candidate("xw-2010", Some("XW")),
        ];
        for (item, year) in
            list.iter_mut()
                .zip([Some(2003), None, Some(1998), Some(1990), Some(2010)])
        {
            item.year = year;
        }
        sort_by_country(&mut list, Some("US"));
        assert_eq!(
            order(&list),
            ["us-1998", "us-2003", "us-none", "xw-2010", "za-1990"]
        );
    }

    #[test]
    fn without_a_country_only_multi_region_releases_are_promoted() {
        let mut list = vec![
            candidate("jp", Some("JP")),
            candidate("xe", Some("XE")),
            candidate("xw", Some("XW")),
        ];
        sort_by_country(&mut list, None);
        assert_eq!(order(&list), ["xw", "xe", "jp"]);
    }

    #[test]
    fn sorts_search_hits_too() {
        let hit = |mbid: &str, country: &str| MusicBrainzEntityHit {
            kind: crate::musicbrainz_entity::MusicBrainzEntityKind::Release,
            mbid: mbid.to_string(),
            title: String::new(),
            artist: None,
            disambiguation: None,
            year: None,
            country: Some(country.to_string()),
            label: None,
            entity_type: None,
            area: None,
            track_count: None,
        };
        let mut hits = vec![hit("za", "ZA"), hit("gb", "GB")];
        sort_by_country(&mut hits, Some("GB"));
        assert_eq!(hits[0].mbid, "gb");
    }
}
