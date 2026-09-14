use crate::activity_log::{self, LogLevel};
use crate::cover_art_fetch::{self, CoverArtCandidate};
use crate::mbid::parse_uuid_mbid;
use crate::musicbrainz_http;
use crate::wikimedia_http;
use reqwest::Url;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, SystemTime};

const CACHE_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const MAX_RESULTS: usize = 12;
const CATEGORY_MEMBER_LIMIT: usize = 50;
const IMAGEINFO_BATCH: usize = 50;
const THUMB_WIDTH: u32 = 250;
const MIN_DIMENSION: u32 = 300;
const WIKIPEDIA_SEARCH_LIMIT: u32 = 8;
const MUSICBRAINZ_REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const ACTIVITY_DOMAIN: &str = "metadata.artistArt";

const MUSICAL_GROUP_TYPES: &[&str] = &[
    "Q215380",    // musical group / band
    "Q5741069",   // rock band
    "Q2088357",   // musical ensemble
    "Q9212979",   // musical duo
    "Q12051390",  // girl group
    "Q61641657",  // boy band
    "Q105756498", // vocal group
    "Q25379",     // choir
    "Q2465852",   // musical project
];

const MUSICIAN_OCCUPATIONS: &[&str] = &[
    "Q177220",   // singer
    "Q639669",   // musician
    "Q36834",    // composer
    "Q488205",   // singer-songwriter
    "Q753110",   // songwriter
    "Q822146",   // lyricist
    "Q183945",   // record producer
    "Q855091",   // guitarist
    "Q2252262",  // rapper
    "Q486748",   // drummer
    "Q13235160", // vocalist
    "Q55960555", // recording artist
    "Q15981151", // jazz musician
    "Q713200",   // conductor
    "Q130857",   // DJ
    "Q1086863",  // bassist
    "Q2494177",  // pianist
    "Q1198887",  // music arranger
    "Q8063498",  // bandleader
    "Q4351403",  // multi-instrumentalist
];

#[derive(Clone)]
struct CacheEntry {
    fetched_at: SystemTime,
    candidates: Vec<CoverArtCandidate>,
}

static FETCH_CACHE: LazyLock<Mutex<HashMap<String, CacheEntry>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ResolvedVia {
    MusicBrainzWikidata,
    MusicBrainzCommons,
    Wikipedia,
}

impl ResolvedVia {
    fn as_str(self) -> &'static str {
        match self {
            ResolvedVia::MusicBrainzWikidata => "musicbrainz-wikidata",
            ResolvedVia::MusicBrainzCommons => "musicbrainz-commons",
            ResolvedVia::Wikipedia => "wikipedia",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum EmptyReason {
    NoMatch,
    NoCategory,
    NoP18,
    FilteredEmpty,
}

impl EmptyReason {
    fn as_str(&self) -> &'static str {
        match self {
            EmptyReason::NoMatch => "noMatch",
            EmptyReason::NoCategory => "noCategory",
            EmptyReason::NoP18 => "noP18",
            EmptyReason::FilteredEmpty => "filteredEmpty",
        }
    }
}

#[derive(Clone, Debug)]
struct Provenance {
    artist: String,
    artist_mbid: Option<String>,
    resolved_via: Option<ResolvedVia>,
    wikidata_qid: Option<String>,
    commons_category: Option<String>,
    wikipedia_title: Option<String>,
    url: Option<String>,
}

impl Provenance {
    fn new(artist: &str, artist_mbid: Option<&str>) -> Self {
        Self {
            artist: artist.to_string(),
            artist_mbid: artist_mbid.map(str::to_string),
            resolved_via: None,
            wikidata_qid: None,
            commons_category: None,
            wikipedia_title: None,
            url: None,
        }
    }

    fn to_json(&self) -> Value {
        let mut map = serde_json::Map::new();
        map.insert("artist".into(), json!(self.artist));
        if let Some(mbid) = &self.artist_mbid {
            map.insert("artistMbid".into(), json!(mbid));
        }
        if let Some(via) = self.resolved_via {
            map.insert("resolvedVia".into(), json!(via.as_str()));
        }
        if let Some(qid) = &self.wikidata_qid {
            map.insert("wikidataQid".into(), json!(qid));
        }
        if let Some(cat) = &self.commons_category {
            map.insert("commonsCategory".into(), json!(cat));
        }
        if let Some(title) = &self.wikipedia_title {
            map.insert("wikipediaTitle".into(), json!(title));
        }
        if let Some(url) = &self.url {
            map.insert("url".into(), json!(url));
        }
        Value::Object(map)
    }
}

struct FetchError {
    message: String,
    url: String,
    http_status: Option<u16>,
    attempts: u32,
    step: &'static str,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum MbArtLink {
    Wikidata(String),
    CommonsCategory(String),
}

struct CommonsFile {
    title: String,
    url: String,
    thumbnail_url: Option<String>,
    file_size: Option<u64>,
    width: Option<u32>,
    height: Option<u32>,
    mime: Option<String>,
}

fn log_artist_art(level: LogLevel, message: impl Into<String>, details: Option<Value>) {
    activity_log::log(level, ACTIVITY_DOMAIN, message, details);
}

pub fn fetch_artist_art_cached(
    artist: String,
    artist_mbid: Option<String>,
) -> Result<Vec<CoverArtCandidate>, String> {
    let trimmed = artist.trim();
    if trimmed.is_empty() {
        return Ok(vec![]);
    }

    let mbid = parse_uuid_mbid(artist_mbid.as_deref());
    let key = cache_key(trimmed, mbid.as_deref());
    prune_expired();

    if let Some(entry) = FETCH_CACHE
        .lock()
        .map_err(|e| e.to_string())?
        .get(&key)
        .cloned()
    {
        if entry.fetched_at.elapsed().unwrap_or(CACHE_TTL) < CACHE_TTL {
            let mut details = Provenance::new(trimmed, mbid.as_deref()).to_json();
            details["candidateCount"] = json!(entry.candidates.len());
            log_artist_art(
                LogLevel::Info,
                format!("In-memory cache hit for \"{trimmed}\""),
                Some(details),
            );
            return Ok(entry.candidates);
        }
    }

    let candidates = fetch_artist_art_uncached(trimmed, mbid.as_deref())?;
    let fetched_at = SystemTime::now();

    FETCH_CACHE.lock().map_err(|e| e.to_string())?.insert(
        key,
        CacheEntry {
            fetched_at,
            candidates: candidates.clone(),
        },
    );

    Ok(candidates)
}

fn cache_key(artist: &str, mbid: Option<&str>) -> String {
    match mbid {
        Some(mbid) => format!("artist|{mbid}"),
        None => format!("artist|{}", artist.to_ascii_lowercase()),
    }
}

fn prune_expired() {
    let Ok(mut cache) = FETCH_CACHE.lock() else {
        return;
    };
    cache.retain(|_, entry| entry.fetched_at.elapsed().unwrap_or(CACHE_TTL) < CACHE_TTL);
}

pub fn clear_fetch_cache() {
    let Ok(mut cache) = FETCH_CACHE.lock() else {
        return;
    };
    cache.clear();
}

/// Activity Log domain for a downloaded image keyed like the editors (`artist:…` vs album/track).
pub fn activity_log_domain_for_cache_key(cache_key: &str) -> &'static str {
    if cache_key.starts_with("artist:") {
        ACTIVITY_DOMAIN
    } else {
        "metadata.coverArt"
    }
}

fn fetch_artist_art_uncached(
    artist: &str,
    artist_mbid: Option<&str>,
) -> Result<Vec<CoverArtCandidate>, String> {
    let mut provenance = Provenance::new(artist, artist_mbid);
    log_artist_art(
        LogLevel::Info,
        format!("Fetching artist art for \"{artist}\""),
        Some(provenance.to_json()),
    );

    match fetch_artist_art_inner(artist, artist_mbid, &mut provenance) {
        Ok((candidates, empty_reason)) => {
            let mut details = provenance.to_json();
            details["candidateCount"] = json!(candidates.len());
            if candidates.is_empty() {
                if let Some(reason) = empty_reason {
                    details["emptyReason"] = json!(reason.as_str());
                }
            }
            log_artist_art(
                if candidates.is_empty() {
                    LogLevel::Warn
                } else {
                    LogLevel::Info
                },
                format!(
                    "Wikimedia Commons returned {} for \"{artist}\"",
                    counted_noun(candidates.len(), "candidate", "candidates"),
                ),
                Some(details),
            );
            Ok(candidates)
        }
        Err(err) => {
            let mut details = provenance.to_json();
            details["url"] = json!(err.url);
            details["step"] = json!(err.step);
            details["attempts"] = json!(err.attempts);
            if let Some(status) = err.http_status {
                details["httpStatus"] = json!(status);
            }
            log_artist_art(
                LogLevel::Error,
                format!("Failed to fetch artist art for \"{artist}\""),
                Some(details),
            );
            Err(err.message)
        }
    }
}

fn fetch_artist_art_inner(
    artist: &str,
    artist_mbid: Option<&str>,
    provenance: &mut Provenance,
) -> Result<(Vec<CoverArtCandidate>, Option<EmptyReason>), FetchError> {
    let wm_client = wikimedia_http::http_client().map_err(|e| FetchError {
        message: format!("Failed to build HTTP client: {e}"),
        url: String::new(),
        http_status: None,
        attempts: 1,
        step: "client",
    })?;

    let mut p18_title: Option<String> = None;

    if let Some(mbid) = artist_mbid {
        match lookup_mb_art_link(mbid, provenance)? {
            Some(MbArtLink::Wikidata(qid)) => {
                provenance.resolved_via = Some(ResolvedVia::MusicBrainzWikidata);
                provenance.wikidata_qid = Some(qid.clone());
                apply_wikidata_entity(&wm_client, &qid, provenance, &mut p18_title)?;
            }
            Some(MbArtLink::CommonsCategory(category)) => {
                provenance.resolved_via = Some(ResolvedVia::MusicBrainzCommons);
                provenance.commons_category = Some(category);
            }
            None => {
                resolve_via_wikipedia(&wm_client, artist, provenance, &mut p18_title)?;
            }
        }
    } else {
        resolve_via_wikipedia(&wm_client, artist, provenance, &mut p18_title)?;
    }

    if provenance.commons_category.is_none() && p18_title.is_none() {
        let reason = if provenance.wikidata_qid.is_none() {
            EmptyReason::NoMatch
        } else {
            EmptyReason::NoP18
        };
        return Ok((vec![], Some(reason)));
    }

    let mut files = Vec::new();
    if let Some(category) = &provenance.commons_category {
        let list_url = commons_categorymembers_url(category);
        provenance.url = Some(list_url.clone());
        let list_json = wm_get_json(&wm_client, &list_url, "commons-members")?;
        files = parse_category_member_titles(&list_json);
    }

    if let Some(p18) = &p18_title {
        let p18_file = file_title(p18);
        if !files.iter().any(|t| file_titles_equal(t, &p18_file)) {
            files.insert(0, p18_file);
        }
    }

    if files.is_empty() {
        return Ok((vec![], Some(EmptyReason::NoCategory)));
    }

    if provenance.url.is_none() {
        provenance.url = Some(commons_imageinfo_url(&files));
    }
    let mut info_files = Vec::new();
    for chunk in files.chunks(IMAGEINFO_BATCH) {
        let chunk_url = commons_imageinfo_url(chunk);
        let info_json = wm_get_json(&wm_client, &chunk_url, "commons-imageinfo")?;
        info_files.extend(parse_imageinfo_files(&info_json));
    }

    let mut candidates = filter_and_rank_candidates(&info_files, p18_title.as_deref());
    cover_art_fetch::embed_csp_safe_thumbnails(&mut candidates, |url| {
        let get = wikimedia_http::send_get(&wm_client, url);
        let response = get.result.ok()?;
        if !response.status().is_success() {
            return None;
        }
        cover_art_fetch::read_capped_image_body(response)
    });
    let empty_reason = if candidates.is_empty() {
        Some(EmptyReason::FilteredEmpty)
    } else {
        None
    };
    Ok((candidates, empty_reason))
}

fn lookup_mb_art_link(
    mbid: &str,
    provenance: &mut Provenance,
) -> Result<Option<MbArtLink>, FetchError> {
    let mb_client = reqwest::blocking::Client::builder()
        .user_agent(crate::USER_AGENT)
        .timeout(MUSICBRAINZ_REQUEST_TIMEOUT)
        .build()
        .map_err(|e| FetchError {
            message: format!("Failed to build HTTP client: {e}"),
            url: String::new(),
            http_status: None,
            attempts: 1,
            step: "musicbrainz",
        })?;

    let url = format!("https://musicbrainz.org/ws/2/artist/{mbid}?inc=url-rels&fmt=json");
    provenance.url = Some(url.clone());
    let get = musicbrainz_http::send_get(&mb_client, &url);
    match get.result {
        Ok(resp) if resp.status().is_success() => {
            let json: Value = resp.json().map_err(|e| FetchError {
                message: format!("Failed to parse MusicBrainz artist response: {e}"),
                url: url.clone(),
                http_status: None,
                attempts: get.attempts,
                step: "musicbrainz",
            })?;
            Ok(parse_mb_artist_art_link(&json))
        }
        Ok(resp) if resp.status().as_u16() == 404 => Ok(None),
        Ok(resp) => {
            let status = resp.status();
            Err(FetchError {
                message: musicbrainz_http::format_http_error(
                    "MusicBrainz artist lookup",
                    status,
                    get.attempts,
                ),
                url,
                http_status: Some(status.as_u16()),
                attempts: get.attempts,
                step: "musicbrainz",
            })
        }
        Err(err) => Err(FetchError {
            message: musicbrainz_http::format_transport_error(
                "MusicBrainz artist lookup",
                &err,
                MUSICBRAINZ_REQUEST_TIMEOUT,
                get.attempts,
            ),
            url,
            http_status: err.status().map(|s| s.as_u16()),
            attempts: get.attempts,
            step: "musicbrainz",
        }),
    }
}

fn apply_wikidata_entity(
    client: &reqwest::blocking::Client,
    qid: &str,
    provenance: &mut Provenance,
    p18_title: &mut Option<String>,
) -> Result<(), FetchError> {
    let url = wikidata_entities_url(&[qid.to_string()]);
    provenance.url = Some(url.clone());
    let json = wm_get_json(client, &url, "wikidata")?;
    let Some(entity) = entity_by_id(&json, qid) else {
        return Ok(());
    };
    fill_from_wikidata_entity(entity, provenance, p18_title);
    Ok(())
}

fn resolve_via_wikipedia(
    client: &reqwest::blocking::Client,
    artist: &str,
    provenance: &mut Provenance,
    p18_title: &mut Option<String>,
) -> Result<(), FetchError> {
    let search_url = wikipedia_search_url(artist);
    provenance.url = Some(search_url.clone());
    let search_json = wm_get_json(client, &search_url, "wikipedia-search")?;
    let ranked = parse_wikipedia_search_qids(&search_json);
    if ranked.is_empty() {
        return Ok(());
    }

    let ids: Vec<String> = ranked.iter().map(|(qid, _)| qid.clone()).collect();
    let entities_url = wikidata_entities_url(&ids);
    let entities_json = wm_get_json(client, &entities_url, "wikidata")?;
    let Some((qid, title)) = pick_qid_from_wikipedia_hits(&ranked, &entities_json) else {
        return Ok(());
    };

    provenance.resolved_via = Some(ResolvedVia::Wikipedia);
    provenance.wikidata_qid = Some(qid.clone());
    provenance.wikipedia_title = Some(title);
    if let Some(entity) = entity_by_id(&entities_json, &qid) {
        fill_from_wikidata_entity(entity, provenance, p18_title);
    }
    Ok(())
}

fn fill_from_wikidata_entity(
    entity: &Value,
    provenance: &mut Provenance,
    p18_title: &mut Option<String>,
) {
    *p18_title = claim_string(entity, "P18");
    let category = claim_string(entity, "P373")
        .and_then(|raw| normalize_commons_category(&raw))
        .or_else(|| commons_sitelink_category(entity));
    if provenance.commons_category.is_none() {
        provenance.commons_category = category;
    }
}

fn wm_get_json(
    client: &reqwest::blocking::Client,
    url: &str,
    step: &'static str,
) -> Result<Value, FetchError> {
    let get = wikimedia_http::send_get(client, url);
    match get.result {
        Ok(resp) if resp.status().is_success() => {
            let json: Value = resp.json().map_err(|e| FetchError {
                message: format!("Failed to parse {step} response: {e}"),
                url: url.to_string(),
                http_status: None,
                attempts: get.attempts,
                step,
            })?;
            if json.get("error").is_some() {
                let code = json
                    .get("error")
                    .and_then(|e| e.get("code"))
                    .and_then(|c| c.as_str())
                    .unwrap_or("error");
                return Err(FetchError {
                    message: format!("{step} returned MediaWiki error {code}"),
                    url: url.to_string(),
                    http_status: None,
                    attempts: get.attempts,
                    step,
                });
            }
            Ok(json)
        }
        Ok(resp) => {
            let status = resp.status();
            Err(FetchError {
                message: wikimedia_http::format_http_error(step, status, get.attempts),
                url: url.to_string(),
                http_status: Some(status.as_u16()),
                attempts: get.attempts,
                step,
            })
        }
        Err(err) => Err(FetchError {
            message: wikimedia_http::format_transport_error(step, &err, get.attempts),
            url: url.to_string(),
            http_status: err.status().map(|s| s.as_u16()),
            attempts: get.attempts,
            step,
        }),
    }
}

fn counted_noun(count: usize, singular: &str, plural: &str) -> String {
    if count == 1 {
        format!("1 {singular}")
    } else {
        format!("{count} {plural}")
    }
}

fn wikipedia_search_url(artist: &str) -> String {
    let mut url = Url::parse("https://en.wikipedia.org/w/api.php").expect("static url");
    url.query_pairs_mut()
        .append_pair("action", "query")
        .append_pair("generator", "search")
        .append_pair("gsrsearch", artist)
        .append_pair("gsrlimit", &WIKIPEDIA_SEARCH_LIMIT.to_string())
        .append_pair("gsrnamespace", "0")
        .append_pair("prop", "pageprops")
        .append_pair("ppprop", "wikibase_item")
        .append_pair("format", "json")
        .append_pair("formatversion", "2");
    url.to_string()
}

fn wikidata_entities_url(ids: &[String]) -> String {
    let mut url = Url::parse("https://www.wikidata.org/w/api.php").expect("static url");
    url.query_pairs_mut()
        .append_pair("action", "wbgetentities")
        .append_pair("ids", &ids.join("|"))
        .append_pair("props", "claims|sitelinks")
        .append_pair("format", "json")
        .append_pair("formatversion", "2");
    url.to_string()
}

fn commons_categorymembers_url(category: &str) -> String {
    let mut url = Url::parse("https://commons.wikimedia.org/w/api.php").expect("static url");
    url.query_pairs_mut()
        .append_pair("action", "query")
        .append_pair("list", "categorymembers")
        .append_pair("cmtitle", &format!("Category:{category}"))
        .append_pair("cmtype", "file")
        .append_pair("cmlimit", &CATEGORY_MEMBER_LIMIT.to_string())
        .append_pair("format", "json")
        .append_pair("formatversion", "2");
    url.to_string()
}

fn commons_imageinfo_url(titles: &[String]) -> String {
    let mut url = Url::parse("https://commons.wikimedia.org/w/api.php").expect("static url");
    url.query_pairs_mut()
        .append_pair("action", "query")
        .append_pair("titles", &titles.join("|"))
        .append_pair("prop", "imageinfo")
        .append_pair("iiprop", "url|size|mime")
        .append_pair("iiurlwidth", &THUMB_WIDTH.to_string())
        .append_pair("format", "json")
        .append_pair("formatversion", "2");
    url.to_string()
}

fn qid_from_wikidata_url(url: &str) -> Option<String> {
    let parsed = Url::parse(url).ok()?;
    let host = parsed.host_str()?;
    if host != "www.wikidata.org" && host != "wikidata.org" {
        return None;
    }
    let mut segs = parsed.path_segments()?;
    let first = segs.next()?;
    if first != "wiki" && first != "entity" {
        return None;
    }
    let id = segs.next()?;
    parse_qid(id)
}

fn parse_qid(raw: &str) -> Option<String> {
    let id = raw.trim();
    if id.len() < 2 {
        return None;
    }
    let (prefix, digits) = id.split_at(1);
    if !prefix.eq_ignore_ascii_case("Q") {
        return None;
    }
    if digits.is_empty() || !digits.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    Some(format!("Q{digits}"))
}

fn commons_category_from_url(url: &str) -> Option<String> {
    let parsed = Url::parse(url).ok()?;
    let host = parsed.host_str()?;
    if host != "commons.wikimedia.org" && host != "commons.m.wikimedia.org" {
        return None;
    }
    let mut segs = parsed.path_segments()?;
    if segs.next()? != "wiki" {
        return None;
    }
    let title = segs.next()?;
    if stripped_prefix_ignore_ascii(title, "Category:").is_none() {
        return None;
    }
    normalize_commons_category(title)
}

fn normalize_commons_category(raw: &str) -> Option<String> {
    let trimmed = raw.trim().replace('_', " ");
    let name = stripped_prefix_ignore_ascii(&trimmed, "Category:")
        .unwrap_or(&trimmed)
        .trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

fn stripped_prefix_ignore_ascii<'a>(value: &'a str, prefix: &str) -> Option<&'a str> {
    if value.len() >= prefix.len() && value[..prefix.len()].eq_ignore_ascii_case(prefix) {
        Some(&value[prefix.len()..])
    } else {
        None
    }
}

fn parse_mb_artist_art_link(artist_json: &Value) -> Option<MbArtLink> {
    let rels = artist_json.get("relations")?.as_array()?;
    let mut commons = None;
    for rel in rels {
        if rel.get("ended").and_then(|v| v.as_bool()) == Some(true) {
            continue;
        }
        let Some(resource) = rel
            .get("url")
            .and_then(|u| u.get("resource"))
            .and_then(|r| r.as_str())
        else {
            continue;
        };
        if let Some(qid) = qid_from_wikidata_url(resource) {
            return Some(MbArtLink::Wikidata(qid));
        }
        if commons.is_none() {
            if let Some(category) = commons_category_from_url(resource) {
                commons = Some(MbArtLink::CommonsCategory(category));
            }
        }
    }
    commons
}

fn parse_wikipedia_search_qids(query_root: &Value) -> Vec<(String, String)> {
    let Some(pages) = query_root.get("query").and_then(|q| q.get("pages")) else {
        return Vec::new();
    };

    let mut items: Vec<(u64, String, String)> = Vec::new();
    let mut push_page = |page: &Value| {
        let title = page.get("title").and_then(|t| t.as_str())?;
        let qid = page
            .get("pageprops")
            .and_then(|p| p.get("wikibase_item"))
            .and_then(|q| q.as_str())
            .and_then(parse_qid)?;
        let index = page
            .get("index")
            .and_then(|i| i.as_u64())
            .unwrap_or(u64::MAX);
        items.push((index, qid, title.to_string()));
        Some(())
    };

    if let Some(arr) = pages.as_array() {
        for page in arr {
            let _ = push_page(page);
        }
    } else if let Some(obj) = pages.as_object() {
        for page in obj.values() {
            let _ = push_page(page);
        }
    }

    items.sort_by_key(|(index, _, _)| *index);
    items
        .into_iter()
        .map(|(_, qid, title)| (qid, title))
        .collect()
}

fn pick_qid_from_wikipedia_hits(
    ranked: &[(String, String)],
    entities: &Value,
) -> Option<(String, String)> {
    let preferred: Vec<(String, String)> = ranked
        .iter()
        .filter(|(qid, _)| {
            entity_by_id(entities, qid)
                .map(entity_is_preferred_artist)
                .unwrap_or(false)
        })
        .cloned()
        .collect();
    preferred
        .into_iter()
        .next()
        .or_else(|| ranked.first().cloned())
}

fn entity_by_id<'a>(root: &'a Value, qid: &str) -> Option<&'a Value> {
    let entities = root.get("entities")?;
    if let Some(obj) = entities.as_object() {
        if let Some(entity) = obj.get(qid) {
            if entity.get("missing").is_none() {
                return Some(entity);
            }
        }
        return obj.values().find(|entity| {
            entity.get("id").and_then(|id| id.as_str()) == Some(qid)
                && entity.get("missing").is_none()
        });
    }
    entities.as_array()?.iter().find(|entity| {
        entity.get("id").and_then(|id| id.as_str()) == Some(qid) && entity.get("missing").is_none()
    })
}

fn entity_is_preferred_artist(entity: &Value) -> bool {
    let p31 = claim_item_ids(entity, "P31");
    if p31.iter().any(|id| {
        MUSICAL_GROUP_TYPES
            .iter()
            .any(|known| *known == id.as_str())
    }) {
        return true;
    }
    if p31.iter().any(|id| id == "Q5") {
        let occupations = claim_item_ids(entity, "P106");
        return occupations.iter().any(|id| {
            MUSICIAN_OCCUPATIONS
                .iter()
                .any(|known| *known == id.as_str())
        });
    }
    false
}

fn preferred_claims<'a>(entity: &'a Value, pid: &str) -> Vec<&'a Value> {
    let Some(arr) = entity
        .get("claims")
        .and_then(|c| c.get(pid))
        .and_then(|v| v.as_array())
    else {
        return Vec::new();
    };
    let preferred: Vec<&Value> = arr
        .iter()
        .filter(|claim| claim_rank(claim) == Some("preferred"))
        .collect();
    if !preferred.is_empty() {
        return preferred;
    }
    arr.iter()
        .filter(|claim| claim_rank(claim) != Some("deprecated"))
        .collect()
}

fn claim_rank(claim: &Value) -> Option<&str> {
    claim.get("rank").and_then(|r| r.as_str())
}

fn claim_string(entity: &Value, pid: &str) -> Option<String> {
    for claim in preferred_claims(entity, pid) {
        if let Some(s) = claim
            .get("mainsnak")
            .and_then(|s| s.get("datavalue"))
            .and_then(|d| d.get("value"))
            .and_then(|v| v.as_str())
        {
            let trimmed = s.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

fn claim_item_ids(entity: &Value, pid: &str) -> Vec<String> {
    preferred_claims(entity, pid)
        .into_iter()
        .filter_map(|claim| {
            claim
                .get("mainsnak")
                .and_then(|s| s.get("datavalue"))
                .and_then(|d| d.get("value"))
                .and_then(|v| v.get("id"))
                .and_then(|id| id.as_str())
                .and_then(parse_qid)
        })
        .collect()
}

fn commons_sitelink_category(entity: &Value) -> Option<String> {
    let title = entity
        .get("sitelinks")
        .and_then(|s| s.get("commonswiki"))
        .and_then(|c| c.get("title"))
        .and_then(|t| t.as_str())?;
    if title.starts_with("Category:") || title.starts_with("category:") {
        normalize_commons_category(title)
    } else {
        None
    }
}

fn parse_category_member_titles(json: &Value) -> Vec<String> {
    let Some(members) = json
        .get("query")
        .and_then(|q| q.get("categorymembers"))
        .and_then(|m| m.as_array())
    else {
        return Vec::new();
    };
    members
        .iter()
        .filter_map(|m| m.get("title").and_then(|t| t.as_str()))
        .filter(|title| title.starts_with("File:") || title.starts_with("file:"))
        .map(str::to_string)
        .take(CATEGORY_MEMBER_LIMIT)
        .collect()
}

fn parse_imageinfo_files(json: &Value) -> Vec<CommonsFile> {
    let Some(pages) = json.get("query").and_then(|q| q.get("pages")) else {
        return Vec::new();
    };
    let mut files = Vec::new();
    let mut push_page = |page: &Value| -> Option<()> {
        if page.get("missing").and_then(|m| m.as_bool()) == Some(true) {
            return None;
        }
        let title = page
            .get("title")
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .to_string();
        let info = page
            .get("imageinfo")
            .and_then(|i| i.as_array())
            .and_then(|arr| arr.first())?;
        let url = info.get("url").and_then(|u| u.as_str())?.to_string();
        files.push(CommonsFile {
            title,
            url,
            thumbnail_url: info
                .get("thumburl")
                .and_then(|u| u.as_str())
                .map(str::to_string),
            file_size: info.get("size").and_then(|s| s.as_u64()).filter(|n| *n > 0),
            width: info
                .get("width")
                .and_then(|w| w.as_u64())
                .and_then(|n| u32::try_from(n).ok()),
            height: info
                .get("height")
                .and_then(|h| h.as_u64())
                .and_then(|n| u32::try_from(n).ok()),
            mime: info
                .get("mime")
                .and_then(|m| m.as_str())
                .map(str::to_string),
        });
        Some(())
    };

    if let Some(arr) = pages.as_array() {
        for page in arr {
            let _ = push_page(page);
        }
    } else if let Some(obj) = pages.as_object() {
        for page in obj.values() {
            let _ = push_page(page);
        }
    }
    files
}

fn file_title(name: &str) -> String {
    let trimmed = name.trim();
    if trimmed.starts_with("File:") || trimmed.starts_with("file:") {
        trimmed.to_string()
    } else {
        format!("File:{trimmed}")
    }
}

fn file_titles_equal(a: &str, b: &str) -> bool {
    normalize_file_title(a) == normalize_file_title(b)
}

fn normalize_file_title(title: &str) -> String {
    let trimmed = title.trim();
    let rest = trimmed
        .strip_prefix("File:")
        .or_else(|| stripped_prefix_ignore_ascii(trimmed, "File:"))
        .unwrap_or(trimmed);
    rest.replace('_', " ").to_ascii_lowercase()
}

fn mime_is_photo(mime: Option<&str>) -> bool {
    let Some(mime) = mime else {
        return true;
    };
    matches!(
        mime,
        "image/jpeg" | "image/jpg" | "image/png" | "image/webp" | "image/gif" | "image/tiff"
    )
}

fn title_is_junk(title: &str) -> bool {
    let lower = normalize_file_title(title);
    lower.contains("logo") || lower.contains("wordmark") || lower.contains("signature")
}

fn below_size_floor(width: Option<u32>, height: Option<u32>) -> bool {
    match (width, height) {
        (Some(w), Some(h)) => w.min(h) < MIN_DIMENSION,
        _ => false,
    }
}

fn filter_and_rank_candidates(
    files: &[CommonsFile],
    p18_title: Option<&str>,
) -> Vec<CoverArtCandidate> {
    let p18_norm = p18_title.map(file_title);

    let mut candidates: Vec<CoverArtCandidate> = files
        .iter()
        .filter(|file| mime_is_photo(file.mime.as_deref()))
        .filter(|file| !title_is_junk(&file.title))
        .filter(|file| !below_size_floor(file.width, file.height))
        .map(|file| {
            let is_p18 = p18_norm
                .as_ref()
                .map(|p18| file_titles_equal(&file.title, p18))
                .unwrap_or(false);
            CoverArtCandidate {
                url: file.url.clone(),
                thumbnail_url: file.thumbnail_url.clone(),
                file_size: file.file_size,
                width: file.width,
                height: file.height,
                canonical_rank: if is_p18 { 0 } else { 1 },
            }
        })
        .collect();

    let mut seen = std::collections::HashSet::new();
    candidates.retain(|c| seen.insert(c.url.clone()));

    candidates.sort_by(|a, b| {
        a.canonical_rank.cmp(&b.canonical_rank).then_with(|| {
            min_dim(b)
                .cmp(&min_dim(a))
                .then_with(|| b.file_size.unwrap_or(0).cmp(&a.file_size.unwrap_or(0)))
        })
    });
    candidates.truncate(MAX_RESULTS);
    candidates
}

fn min_dim(candidate: &CoverArtCandidate) -> u32 {
    match (candidate.width, candidate.height) {
        (Some(w), Some(h)) => w.min(h),
        (Some(w), None) => w,
        (None, Some(h)) => h,
        (None, None) => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clear_fetch_cache_empties_entries() {
        FETCH_CACHE.lock().unwrap().insert(
            "artist|test".to_string(),
            CacheEntry {
                fetched_at: SystemTime::now(),
                candidates: vec![],
            },
        );
        clear_fetch_cache();
        assert!(FETCH_CACHE.lock().unwrap().is_empty());
    }

    #[test]
    fn activity_log_domain_for_cache_key_splits_artist_from_cover() {
        assert_eq!(
            activity_log_domain_for_cache_key("artist:Radiohead"),
            "metadata.artistArt"
        );
        assert_eq!(
            activity_log_domain_for_cache_key("/Music/album/front.jpg"),
            "metadata.coverArt"
        );
    }

    #[test]
    fn empty_artist_name_returns_empty_without_fetch() {
        assert!(fetch_artist_art_cached("  ".into(), None)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn cache_key_uses_mbid_when_present() {
        assert_eq!(
            cache_key("Radiohead", Some("a74b1b7f-71a5-4011-9441-d0b5e4122711")),
            "artist|a74b1b7f-71a5-4011-9441-d0b5e4122711"
        );
        assert_eq!(cache_key("Radiohead", None), "artist|radiohead");
    }

    #[test]
    fn parse_mb_url_rels_prefers_wikidata_over_commons() {
        let json = json!({
            "relations": [
                {
                    "type": "image",
                    "url": { "resource": "https://commons.wikimedia.org/wiki/Category:Radiohead" }
                },
                {
                    "type": "wikidata",
                    "url": { "resource": "https://www.wikidata.org/wiki/Q180325" }
                }
            ]
        });
        assert_eq!(
            parse_mb_artist_art_link(&json),
            Some(MbArtLink::Wikidata("Q180325".into()))
        );
    }

    #[test]
    fn parse_mb_url_rels_falls_back_to_commons_category() {
        let json = json!({
            "relations": [
                {
                    "type": "image",
                    "url": { "resource": "https://commons.wikimedia.org/wiki/File:Radiohead.jpg" }
                },
                {
                    "type": "other",
                    "url": { "resource": "https://commons.wikimedia.org/wiki/Category:The_Beatles" }
                }
            ]
        });
        assert_eq!(
            parse_mb_artist_art_link(&json),
            Some(MbArtLink::CommonsCategory("The Beatles".into()))
        );
    }

    #[test]
    fn parse_mb_url_rels_skips_ended_and_file_pages() {
        let json = json!({
            "relations": [
                {
                    "type": "wikidata",
                    "ended": true,
                    "url": { "resource": "https://www.wikidata.org/wiki/Q1" }
                },
                {
                    "type": "image",
                    "url": { "resource": "https://commons.wikimedia.org/wiki/File:Portrait.jpg" }
                }
            ]
        });
        assert_eq!(parse_mb_artist_art_link(&json), None);
    }

    #[test]
    fn wikipedia_search_picks_musician_over_top_non_musician() {
        let search = json!({
            "query": {
                "pages": [
                    {
                        "title": "Queen (monarch)",
                        "index": 1,
                        "pageprops": { "wikibase_item": "Q9682" }
                    },
                    {
                        "title": "Queen (band)",
                        "index": 2,
                        "pageprops": { "wikibase_item": "Q15862" }
                    }
                ]
            }
        });
        let ranked = parse_wikipedia_search_qids(&search);
        assert_eq!(ranked[0].0, "Q9682");
        let entities = json!({
            "entities": {
                "Q9682": {
                    "id": "Q9682",
                    "claims": {
                        "P31": [item_claim("Q5")],
                        "P106": [item_claim("Q116")]
                    }
                },
                "Q15862": {
                    "id": "Q15862",
                    "claims": {
                        "P31": [item_claim("Q215380")]
                    }
                }
            }
        });
        let picked = pick_qid_from_wikipedia_hits(&ranked, &entities).unwrap();
        assert_eq!(picked.0, "Q15862");
        assert_eq!(picked.1, "Queen (band)");
    }

    #[test]
    fn wikipedia_search_falls_back_to_top_hit_when_filter_empty() {
        let ranked = vec![
            ("Q84".to_string(), "London".into()),
            ("Q90".to_string(), "Paris".into()),
        ];
        let entities = json!({
            "entities": {
                "Q84": {
                    "id": "Q84",
                    "claims": { "P31": [item_claim("Q515")] }
                },
                "Q90": {
                    "id": "Q90",
                    "claims": { "P31": [item_claim("Q515")] }
                }
            }
        });
        let picked = pick_qid_from_wikipedia_hits(&ranked, &entities).unwrap();
        assert_eq!(picked.0, "Q84");
    }

    #[test]
    fn wikipedia_human_singer_is_preferred() {
        let entity = json!({
            "claims": {
                "P31": [item_claim("Q5")],
                "P106": [item_claim("Q177220")]
            }
        });
        assert!(entity_is_preferred_artist(&entity));
        let actor = json!({
            "claims": {
                "P31": [item_claim("Q5")],
                "P106": [item_claim("Q33999")]
            }
        });
        assert!(!entity_is_preferred_artist(&actor));
    }

    #[test]
    fn category_and_imageinfo_filter_keeps_photos() {
        let members = json!({
            "query": {
                "categorymembers": [
                    { "title": "File:Radiohead live.jpg" },
                    { "title": "File:Radiohead logo.svg" },
                    { "ns": 14, "title": "Category:Radiohead members" }
                ]
            }
        });
        let titles = parse_category_member_titles(&members);
        assert_eq!(
            titles,
            vec!["File:Radiohead live.jpg", "File:Radiohead logo.svg"]
        );

        let info = json!({
            "query": {
                "pages": [
                    imageinfo_page(
                        "File:Radiohead live.jpg",
                        "https://upload.example/live.jpg",
                        Some("https://upload.example/live-250.jpg"),
                        1200,
                        800,
                        400_000,
                        "image/jpeg",
                    ),
                    imageinfo_page(
                        "File:Radiohead logo.svg",
                        "https://upload.example/logo.svg",
                        None,
                        512,
                        512,
                        12_000,
                        "image/svg+xml",
                    )
                ]
            }
        });
        let files = parse_imageinfo_files(&info);
        let candidates = filter_and_rank_candidates(&files, None);
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].url, "https://upload.example/live.jpg");
        assert_eq!(
            candidates[0].thumbnail_url.as_deref(),
            Some("https://upload.example/live-250.jpg")
        );
    }

    #[test]
    fn p18_merges_when_absent_from_members_and_sorts_first() {
        let members = vec![
            commons_file(
                "File:Live.jpg",
                "https://upload.example/live.jpg",
                800,
                800,
                100_000,
                "image/jpeg",
            ),
            commons_file(
                "File:Studio.jpg",
                "https://upload.example/studio.jpg",
                2000,
                2000,
                500_000,
                "image/jpeg",
            ),
        ];
        let p18 = commons_file(
            "File:Canonical.jpg",
            "https://upload.example/canonical.jpg",
            400,
            400,
            50_000,
            "image/jpeg",
        );
        let mut all = members;
        all.push(p18);
        let candidates = filter_and_rank_candidates(&all, Some("Canonical.jpg"));
        assert_eq!(candidates[0].url, "https://upload.example/canonical.jpg");
        assert_eq!(candidates[0].canonical_rank, 0);
        assert_eq!(candidates[1].url, "https://upload.example/studio.jpg");
    }

    #[test]
    fn drops_svg_logo_wordmark_signature_and_tiny_images() {
        let files = vec![
            commons_file(
                "File:Band logo.png",
                "https://upload.example/logo.png",
                800,
                800,
                20_000,
                "image/png",
            ),
            commons_file(
                "File:Wordmark.png",
                "https://upload.example/wordmark.png",
                1000,
                400,
                30_000,
                "image/png",
            ),
            commons_file(
                "File:Artist signature.jpg",
                "https://upload.example/sig.jpg",
                900,
                400,
                40_000,
                "image/jpeg",
            ),
            commons_file(
                "File:Tiny.jpg",
                "https://upload.example/tiny.jpg",
                120,
                120,
                8_000,
                "image/jpeg",
            ),
            commons_file(
                "File:Chart.pdf",
                "https://upload.example/chart.pdf",
                2000,
                2000,
                80_000,
                "application/pdf",
            ),
            commons_file(
                "File:On stage.jpg",
                "https://upload.example/live.jpg",
                1400,
                900,
                200_000,
                "image/jpeg",
            ),
        ];
        let candidates = filter_and_rank_candidates(&files, None);
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].url, "https://upload.example/live.jpg");
    }

    #[test]
    fn filter_empty_yields_empty_vec() {
        let files = vec![commons_file(
            "File:Logo.svg",
            "https://upload.example/logo.svg",
            800,
            800,
            10_000,
            "image/svg+xml",
        )];
        assert!(filter_and_rank_candidates(&files, None).is_empty());
    }

    #[test]
    fn wikidata_entity_reads_p18_p373_and_commons_sitelink() {
        let entity = json!({
            "claims": {
                "P18": [{
                    "rank": "normal",
                    "mainsnak": { "datavalue": { "value": "Radiohead.jpg", "type": "string" } }
                }],
                "P373": [{
                    "rank": "normal",
                    "mainsnak": { "datavalue": { "value": "Radiohead", "type": "string" } }
                }]
            },
            "sitelinks": {
                "commonswiki": { "title": "Category:Radiohead" }
            }
        });
        let mut provenance = Provenance::new("Radiohead", None);
        let mut p18 = None;
        fill_from_wikidata_entity(&entity, &mut provenance, &mut p18);
        assert_eq!(p18.as_deref(), Some("Radiohead.jpg"));
        assert_eq!(provenance.commons_category.as_deref(), Some("Radiohead"));
    }

    #[test]
    fn commons_sitelink_file_page_is_not_a_category() {
        let entity = json!({
            "sitelinks": { "commonswiki": { "title": "Radiohead" } }
        });
        assert_eq!(commons_sitelink_category(&entity), None);
    }

    fn item_claim(qid: &str) -> Value {
        json!({
            "rank": "normal",
            "mainsnak": {
                "datavalue": {
                    "value": { "id": qid, "entity-type": "item" },
                    "type": "wikibase-entityid"
                }
            }
        })
    }

    fn imageinfo_page(
        title: &str,
        url: &str,
        thumb: Option<&str>,
        width: u32,
        height: u32,
        size: u64,
        mime: &str,
    ) -> Value {
        let mut info = json!({
            "url": url,
            "width": width,
            "height": height,
            "size": size,
            "mime": mime,
        });
        if let Some(thumb) = thumb {
            info["thumburl"] = json!(thumb);
        }
        json!({
            "title": title,
            "imageinfo": [info]
        })
    }

    fn commons_file(
        title: &str,
        url: &str,
        width: u32,
        height: u32,
        size: u64,
        mime: &str,
    ) -> CommonsFile {
        CommonsFile {
            title: title.into(),
            url: url.into(),
            thumbnail_url: Some(format!("{url}?w=250")),
            file_size: Some(size),
            width: Some(width),
            height: Some(height),
            mime: Some(mime.into()),
        }
    }
}
