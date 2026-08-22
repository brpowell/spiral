use std::collections::HashMap;

use quick_xml::events::Event;
use quick_xml::Reader;

#[derive(Debug, Clone)]
pub struct WmsNode {
    pub tag: String,
    pub attrs: HashMap<String, String>,
    pub children: Vec<WmsNode>,
}

pub fn decode_wms_bytes(bytes: &[u8]) -> String {
    if bytes.len() >= 2 && bytes[0] == 0xff && bytes[1] == 0xfe {
        return decode_utf16_le(bytes);
    }
    if bytes.len() >= 2 && bytes[0] == 0xfe && bytes[1] == 0xff {
        return decode_utf16_be(bytes);
    }
    if bytes.len() >= 3 && bytes[0] == 0xef && bytes[1] == 0xbb && bytes[2] == 0xbf {
        let (cow, _, _) = encoding_rs::UTF_8.decode(bytes);
        return cow.into_owned();
    }
    let n = bytes.len().min(200);
    let nul_count = bytes[..n].iter().filter(|&&b| b == 0).count();
    if nul_count > 20 {
        return decode_utf16_le(bytes);
    }
    let (cow, _, _) = encoding_rs::UTF_8.decode(bytes);
    cow.into_owned()
}

fn decode_utf16_le(bytes: &[u8]) -> String {
    let (cow, _, _) = encoding_rs::UTF_16LE.decode(bytes);
    cow.into_owned()
}

fn decode_utf16_be(bytes: &[u8]) -> String {
    let (cow, _, _) = encoding_rs::UTF_16BE.decode(bytes);
    cow.into_owned()
}

pub fn parse_wms_xml(xml: &str) -> Result<WmsNode, String> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();
    let mut stack: Vec<WmsNode> = Vec::new();
    let mut roots: Vec<WmsNode> = Vec::new();

    loop {
        let event = reader
            .read_event_into(&mut buf)
            .map_err(|e| format!("WMS XML parse error: {e}"))?;
        match event {
            Event::Start(e) => {
                let node = node_from_bytes(&e)?;
                stack.push(node);
            }
            Event::Empty(e) => {
                let node = node_from_bytes(&e)?;
                if let Some(parent) = stack.last_mut() {
                    parent.children.push(node);
                } else {
                    roots.push(node);
                }
            }
            Event::End(_) => {
                let Some(finished) = stack.pop() else {
                    continue;
                };
                if let Some(parent) = stack.last_mut() {
                    parent.children.push(finished);
                } else {
                    roots.push(finished);
                }
            }
            Event::Eof => break,
            _ => {}
        }
        buf.clear();
    }

    roots
        .into_iter()
        .find(|n| n.tag == "theme")
        .ok_or_else(|| "WMS has no <theme> root".to_string())
}

fn node_from_bytes(e: &quick_xml::events::BytesStart<'_>) -> Result<WmsNode, String> {
    let tag = String::from_utf8_lossy(e.name().as_ref()).to_ascii_lowercase();
    let mut attrs = HashMap::new();
    // WMS skins sometimes repeat attributes; last wins.
    for attr in e.attributes().with_checks(false) {
        let attr = attr.map_err(|err| format!("WMS attribute error: {err}"))?;
        let key = String::from_utf8_lossy(attr.key.as_ref()).to_ascii_lowercase();
        let value = attr
            .unescape_value()
            .map(|v| v.into_owned())
            .map_err(|err| format!("WMS attribute value error: {err}"))?;
        attrs.insert(key, value.trim().to_string());
    }
    Ok(WmsNode {
        tag,
        attrs,
        children: Vec::new(),
    })
}

pub fn walk_wms(node: &mut WmsNode, visit: &mut dyn FnMut(&mut WmsNode)) {
    visit(node);
    for child in &mut node.children {
        walk_wms(child, visit);
    }
}

pub fn visit_wms(node: &WmsNode, visit: &mut dyn FnMut(&WmsNode)) {
    visit(node);
    for child in &node.children {
        visit_wms(child, visit);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_utf16_le_with_bom() {
        let xml = r#"<theme id="Plus! Nature"><view width="10" height="10"/></theme>"#;
        let mut bytes = vec![0xff, 0xfe];
        for u in xml.encode_utf16() {
            bytes.extend_from_slice(&u.to_le_bytes());
        }
        let decoded = decode_wms_bytes(&bytes);
        assert!(decoded.contains("Plus! Nature"));
    }

    #[test]
    fn lowercases_tags_and_attributes() {
        let root = parse_wms_xml(
            r#"
      <THEME ID="Demo" Author="MS">
        <VIEW width="474" height="600">
          <SubView id="svMain" Left="0" Top="10" backgroundImage="img_base.bmp">
            <BUTTON id="quit" onClick="view.close();" image="btn_quit.bmp"/>
          </SubView>
        </VIEW>
      </THEME>
    "#,
        )
        .expect("parse");
        assert_eq!(root.tag, "theme");
        assert_eq!(root.attrs.get("id").map(String::as_str), Some("Demo"));
        assert_eq!(root.attrs.get("author").map(String::as_str), Some("MS"));
        let view = &root.children[0];
        assert_eq!(view.tag, "view");
        let sub = &view.children[0];
        assert_eq!(sub.tag, "subview");
        assert_eq!(
            sub.attrs.get("backgroundimage").map(String::as_str),
            Some("img_base.bmp")
        );
        assert_eq!(sub.children[0].tag, "button");
    }
}
