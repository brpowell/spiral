//! Fractional position keys for ordered lists (playlist tracks, the playlist sidebar).
//!
//! A port of the `fractional-indexing` key format (base62 digits `0-9A-Za-z`). A key is an
//! integer part, whose head letter gives its length (`a0`..`az`, then `b00`..), followed by an
//! optional fraction. Keys compare as plain strings, and a key can always be made between any
//! two others, so moving an item writes only that item's row.

const DIGITS: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ZERO: u8 = DIGITS[0];
const LAST: u8 = DIGITS[DIGITS.len() - 1];
/// The smallest integer part, which has no key before it.
const SMALLEST_INTEGER: &str = "A00000000000000000000000000";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PositionKeyError(String);

impl std::fmt::Display for PositionKeyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "position key: {}", self.0)
    }
}

impl std::error::Error for PositionKeyError {}

fn err(message: impl Into<String>) -> PositionKeyError {
    PositionKeyError(message.into())
}

fn digit_index(byte: u8) -> Result<usize, PositionKeyError> {
    DIGITS
        .iter()
        .position(|&d| d == byte)
        .ok_or_else(|| err(format!("invalid digit {:?}", byte as char)))
}

/// A fraction strictly between `a` and `b` (`None` means no upper bound). Both are digit
/// strings without trailing zeros.
fn midpoint(a: &[u8], b: Option<&[u8]>) -> Result<Vec<u8>, PositionKeyError> {
    if let Some(b) = b {
        if a >= b {
            return Err(err("bounds out of order"));
        }
    }
    if a.last() == Some(&ZERO) || b.and_then(|b| b.last()) == Some(&ZERO) {
        return Err(err("trailing zero"));
    }
    if let Some(b) = b {
        let mut n = 0;
        while n < b.len() && a.get(n).copied().unwrap_or(ZERO) == b[n] {
            n += 1;
        }
        if n > 0 {
            let a_rest = if n < a.len() { &a[n..] } else { &[][..] };
            let mut out = b[..n].to_vec();
            out.extend(midpoint(a_rest, Some(&b[n..]))?);
            return Ok(out);
        }
    }
    let digit_a = match a.first() {
        Some(&d) => digit_index(d)?,
        None => 0,
    };
    let digit_b = match b {
        Some(b) => digit_index(b[0])?,
        None => DIGITS.len(),
    };
    if digit_b - digit_a > 1 {
        return Ok(vec![DIGITS[(digit_a + digit_b).div_ceil(2)]]);
    }
    if let Some(b) = b {
        if b.len() > 1 {
            return Ok(vec![b[0]]);
        }
    }
    let a_rest = if a.len() > 1 { &a[1..] } else { &[][..] };
    let mut out = vec![DIGITS[digit_a]];
    out.extend(midpoint(a_rest, None)?);
    Ok(out)
}

fn integer_length(head: u8) -> Result<usize, PositionKeyError> {
    match head {
        b'a'..=b'z' => Ok((head - b'a') as usize + 2),
        b'A'..=b'Z' => Ok((b'Z' - head) as usize + 2),
        _ => Err(err(format!("invalid head {:?}", head as char))),
    }
}

fn split(key: &str) -> Result<(&[u8], &[u8]), PositionKeyError> {
    let bytes = key.as_bytes();
    let head = *bytes.first().ok_or_else(|| err("empty key"))?;
    let len = integer_length(head)?;
    if len > bytes.len() {
        return Err(err(format!("key {key:?} is too short")));
    }
    let (integer, fraction) = bytes.split_at(len);
    for &d in &bytes[1..] {
        digit_index(d)?;
    }
    if fraction.last() == Some(&ZERO) {
        return Err(err(format!("key {key:?} has a trailing zero")));
    }
    if key == SMALLEST_INTEGER {
        return Err(err("key is the smallest integer"));
    }
    Ok((integer, fraction))
}

fn increment_integer(integer: &[u8]) -> Result<Option<Vec<u8>>, PositionKeyError> {
    let head = integer[0];
    let mut digits = integer[1..].to_vec();
    let mut carry = true;
    for slot in digits.iter_mut().rev() {
        let d = digit_index(*slot)? + 1;
        if d == DIGITS.len() {
            *slot = ZERO;
        } else {
            *slot = DIGITS[d];
            carry = false;
            break;
        }
    }
    if !carry {
        let mut out = vec![head];
        out.extend(digits);
        return Ok(Some(out));
    }
    match head {
        b'Z' => Ok(Some(vec![b'a', ZERO])),
        b'z' => Ok(None),
        _ => {
            let next = head + 1;
            if next > b'a' {
                digits.push(ZERO);
            } else {
                digits.pop();
            }
            let mut out = vec![next];
            out.extend(digits);
            Ok(Some(out))
        }
    }
}

fn decrement_integer(integer: &[u8]) -> Result<Option<Vec<u8>>, PositionKeyError> {
    let head = integer[0];
    let mut digits = integer[1..].to_vec();
    let mut borrow = true;
    for slot in digits.iter_mut().rev() {
        let d = digit_index(*slot)?;
        if d == 0 {
            *slot = LAST;
        } else {
            *slot = DIGITS[d - 1];
            borrow = false;
            break;
        }
    }
    if !borrow {
        let mut out = vec![head];
        out.extend(digits);
        return Ok(Some(out));
    }
    match head {
        b'a' => Ok(Some(vec![b'Z', LAST])),
        b'A' => Ok(None),
        _ => {
            let prev = head - 1;
            if prev < b'Z' {
                digits.push(LAST);
            } else {
                digits.pop();
            }
            let mut out = vec![prev];
            out.extend(digits);
            Ok(Some(out))
        }
    }
}

fn into_key(bytes: Vec<u8>) -> String {
    String::from_utf8(bytes).expect("position keys are ascii")
}

/// A key that sorts after `before` and before `after`. `None` leaves that side open, so
/// `key_between(None, None)` is the first key of an empty list and `key_between(Some(last), None)`
/// appends.
pub fn key_between(before: Option<&str>, after: Option<&str>) -> Result<String, PositionKeyError> {
    let a = before.map(split).transpose()?;
    let b = after.map(split).transpose()?;
    if let (Some(before), Some(after)) = (before, after) {
        if before >= after {
            return Err(err(format!("{before:?} is not before {after:?}")));
        }
    }
    match (a, b) {
        (None, None) => Ok("a0".to_owned()),
        (None, Some((ib, fb))) => {
            let after = after.expect("after is set");
            if ib == SMALLEST_INTEGER.as_bytes() {
                let mut out = ib.to_vec();
                out.extend(midpoint(&[], Some(fb))?);
                return Ok(into_key(out));
            }
            if ib.len() < after.len() {
                return Ok(into_key(ib.to_vec()));
            }
            decrement_integer(ib)?
                .map(into_key)
                .ok_or_else(|| err("no key before the smallest key"))
        }
        (Some((ia, fa)), None) => match increment_integer(ia)? {
            Some(next) => Ok(into_key(next)),
            None => {
                let mut out = ia.to_vec();
                out.extend(midpoint(fa, None)?);
                Ok(into_key(out))
            }
        },
        (Some((ia, fa)), Some((ib, fb))) => {
            if ia == ib {
                let mut out = ia.to_vec();
                out.extend(midpoint(fa, Some(fb))?);
                return Ok(into_key(out));
            }
            let next = increment_integer(ia)?.ok_or_else(|| err("no key after the largest key"))?;
            if next.as_slice() < after.expect("after is set").as_bytes() {
                return Ok(into_key(next));
            }
            let mut out = ia.to_vec();
            out.extend(midpoint(fa, None)?);
            Ok(into_key(out))
        }
    }
}

/// `count` keys in order, all after `before` and before `after`. Keys made between two bounds
/// are split recursively, so they stay short.
pub fn keys_between(
    before: Option<&str>,
    after: Option<&str>,
    count: usize,
) -> Result<Vec<String>, PositionKeyError> {
    match count {
        0 => return Ok(Vec::new()),
        1 => return Ok(vec![key_between(before, after)?]),
        _ => {}
    }
    if after.is_none() {
        let mut keys = Vec::with_capacity(count);
        let mut last = key_between(before, None)?;
        keys.push(last.clone());
        for _ in 1..count {
            last = key_between(Some(&last), None)?;
            keys.push(last.clone());
        }
        return Ok(keys);
    }
    if before.is_none() {
        let mut keys = Vec::with_capacity(count);
        let mut first = key_between(None, after)?;
        keys.push(first.clone());
        for _ in 1..count {
            first = key_between(None, Some(&first))?;
            keys.push(first.clone());
        }
        keys.reverse();
        return Ok(keys);
    }
    let mid = count / 2;
    let middle = key_between(before, after)?;
    let mut keys = keys_between(before, Some(&middle), mid)?;
    keys.push(middle.clone());
    keys.extend(keys_between(Some(&middle), after, count - mid - 1)?);
    Ok(keys)
}

/// New keys that put a keyed list into `desired` order, rewriting as few items as possible.
///
/// `current` is the list in its stored order with each item's key. The longest run of items that
/// are already in order keep their keys; every other item gets a key between its new neighbours.
/// Returns only the items whose key changes. Moving one item changes one key.
pub fn reorder<T>(
    current: &[(T, String)],
    desired: &[T],
) -> Result<Vec<(T, String)>, PositionKeyError>
where
    T: Eq + std::hash::Hash + Clone,
{
    let index: std::collections::HashMap<&T, usize> = current
        .iter()
        .enumerate()
        .map(|(i, (id, _))| (id, i))
        .collect();
    let order: Vec<usize> = desired
        .iter()
        .map(|id| index.get(id).copied().ok_or_else(|| err("unknown item")))
        .collect::<Result<_, _>>()?;
    let kept = longest_increasing(&order);

    let mut changes = Vec::new();
    let mut i = 0;
    let mut before: Option<String> = None;
    while i < desired.len() {
        if kept[i] {
            before = Some(current[order[i]].1.clone());
            i += 1;
            continue;
        }
        let start = i;
        while i < desired.len() && !kept[i] {
            i += 1;
        }
        let after = (i < desired.len()).then(|| current[order[i]].1.as_str());
        let keys = keys_between(before.as_deref(), after, i - start)?;
        for (id, key) in desired[start..i].iter().zip(keys) {
            changes.push((id.clone(), key));
        }
        before = changes.last().map(|(_, key)| key.clone());
    }
    Ok(changes)
}

/// Which positions of `values` form one longest strictly increasing subsequence.
fn longest_increasing(values: &[usize]) -> Vec<bool> {
    // tails[k]: index into `values` of the smallest tail of an increasing run of length k + 1.
    let mut tails: Vec<usize> = Vec::new();
    let mut previous = vec![usize::MAX; values.len()];
    for (i, &value) in values.iter().enumerate() {
        let k = tails.partition_point(|&t| values[t] < value);
        if k > 0 {
            previous[i] = tails[k - 1];
        }
        if k == tails.len() {
            tails.push(i);
        } else {
            tails[k] = i;
        }
    }
    let mut kept = vec![false; values.len()];
    let mut at = tails.last().copied();
    while let Some(i) = at {
        kept[i] = true;
        at = (previous[i] != usize::MAX).then_some(previous[i]);
    }
    kept
}

#[cfg(test)]
mod tests {
    use super::*;

    fn between(a: Option<&str>, b: Option<&str>) -> String {
        key_between(a, b).expect("key")
    }

    #[test]
    fn matches_the_reference_implementation() {
        // Cases from the fractional-indexing test suite.
        assert_eq!(between(None, None), "a0");
        assert_eq!(between(None, Some("a0")), "Zz");
        assert_eq!(between(None, Some("Zz")), "Zy");
        assert_eq!(between(Some("a0"), None), "a1");
        assert_eq!(between(Some("a1"), None), "a2");
        assert_eq!(between(Some("a0"), Some("a1")), "a0V");
        assert_eq!(between(Some("a1"), Some("a2")), "a1V");
        assert_eq!(between(Some("a0V"), Some("a1")), "a0l");
        assert_eq!(between(Some("Zz"), Some("a0")), "ZzV");
        assert_eq!(between(Some("Zz"), Some("a1")), "a0");
        assert_eq!(between(None, Some("Y00")), "Xzzz");
        assert_eq!(between(Some("bzz"), None), "c000");
        assert_eq!(between(Some("a0"), Some("a0V")), "a0G");
        assert_eq!(between(Some("a0"), Some("a0G")), "a08");
        assert_eq!(between(Some("b125"), Some("b129")), "b127");
        assert_eq!(between(Some("a0"), Some("a1V")), "a1");
        assert_eq!(between(Some("Zz"), Some("a01")), "a0");
        assert_eq!(between(None, Some("a0V")), "a0");
        assert_eq!(between(None, Some("b999")), "b99");
        assert_eq!(between(Some("az"), None), "b00");
    }

    #[test]
    fn rejects_bad_input() {
        assert!(key_between(Some("a1"), Some("a0")).is_err());
        assert!(key_between(Some("a0"), Some("a0")).is_err());
        assert!(key_between(Some("a00"), None).is_err());
        assert!(key_between(Some(""), None).is_err());
        assert!(key_between(Some("0"), None).is_err());
        assert!(key_between(Some("b0"), None).is_err());
        assert!(key_between(Some("a0!"), None).is_err());
    }

    #[test]
    fn appended_keys_sort_in_order() {
        let keys = keys_between(None, None, 5000).expect("keys");
        assert_eq!(&keys[..3], ["a0", "a1", "a2"]);
        let mut sorted = keys.clone();
        sorted.sort();
        assert_eq!(keys, sorted);
    }

    #[test]
    fn repeated_inserts_at_the_front_stay_ordered() {
        let mut first = "a0".to_owned();
        for _ in 0..500 {
            let next = between(None, Some(&first));
            assert!(next < first);
            first = next;
        }
    }

    #[test]
    fn repeated_inserts_between_two_keys_stay_ordered() {
        let low = "a0".to_owned();
        let mut high = "a1".to_owned();
        for _ in 0..200 {
            let mid = between(Some(&low), Some(&high));
            assert!(low < mid && mid < high);
            high = mid;
        }
    }

    #[test]
    fn keys_between_bounds_are_ordered_and_short() {
        let keys = keys_between(Some("a0"), Some("a1"), 1000).expect("keys");
        assert!(keys.windows(2).all(|w| w[0] < w[1]));
        assert!(keys.first().unwrap().as_str() > "a0" && keys.last().unwrap().as_str() < "a1");
        assert!(
            keys.iter().all(|k| k.len() <= 6),
            "keys grew long: {keys:?}"
        );
        let front = keys_between(None, Some("a0"), 3).expect("keys");
        assert!(front.windows(2).all(|w| w[0] < w[1]) && front[2].as_str() < "a0");
    }

    fn keyed(ids: &[&'static str]) -> Vec<(&'static str, String)> {
        ids.iter()
            .copied()
            .zip(keys_between(None, None, ids.len()).unwrap())
            .collect()
    }

    fn apply(current: &[(&'static str, String)], desired: &[&'static str]) -> usize {
        let changes = reorder(current, desired).expect("reorder");
        let mut merged: std::collections::HashMap<&str, String> = current.iter().cloned().collect();
        for (id, key) in &changes {
            merged.insert(id, key.clone());
        }
        let mut sorted: Vec<&str> = desired.to_vec();
        sorted.sort_by(|a, b| merged[a].cmp(&merged[b]));
        assert_eq!(sorted, desired);
        changes.len()
    }

    #[test]
    fn moving_one_item_rewrites_only_that_item() {
        let current = keyed(&["a", "b", "c", "d", "e"]);
        assert_eq!(apply(&current, &["a", "b", "c", "d", "e"]), 0);
        assert_eq!(apply(&current, &["e", "a", "b", "c", "d"]), 1);
        assert_eq!(apply(&current, &["b", "c", "d", "e", "a"]), 1);
        assert_eq!(apply(&current, &["a", "d", "b", "c", "e"]), 1);
    }

    #[test]
    fn any_reorder_ends_in_the_desired_order() {
        let current = keyed(&["a", "b", "c", "d", "e", "f"]);
        assert_eq!(apply(&current, &["f", "e", "d", "c", "b", "a"]), 5);
        apply(&current, &["c", "a", "f", "b", "e", "d"]);
        apply(&current, &["b", "a", "d", "c", "f", "e"]);
    }

    #[test]
    fn reorder_rejects_unknown_items() {
        let current = keyed(&["a", "b"]);
        assert!(reorder(&current, &["a", "z"]).is_err());
    }
}
