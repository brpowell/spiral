pub struct PcmStream {
    pub channels: u16,
    pub sample_rate: u32,
    pub samples: Vec<i16>,
}
