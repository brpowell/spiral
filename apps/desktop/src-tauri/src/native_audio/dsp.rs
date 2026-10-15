//! Output effects that mirror the Web Audio graph they replace: a 10-band
//! graphic EQ built from peaking biquads (with preamp and a bypass blend) and
//! the equal-power stereo panner.

use std::f64::consts::{FRAC_PI_2, TAU};

pub const EQ_BAND_COUNT: usize = 10;
pub const EQ_BAND_FREQUENCIES_HZ: [f64; EQ_BAND_COUNT] = [
    31.0, 63.0, 125.0, 250.0, 500.0, 1_000.0, 2_000.0, 4_000.0, 8_000.0, 16_000.0,
];
const EQ_GAIN_LIMIT_DB: f32 = 12.0;
/// Matches the webview chain's `FILTER_Q`.
const FILTER_Q: f64 = 1.4;
/// Time to blend between the dry and EQ'd signal when toggling the EQ.
const BYPASS_BLEND_SECONDS: f32 = 0.010;
/// Largest device channel count the EQ keeps filter state for.
const MAX_EQ_CHANNELS: usize = 8;

/// What the UI edits: per-band dB gains, preamp dB and the enable switch.
#[derive(Debug, Clone, PartialEq)]
pub struct EqSettings {
    pub enabled: bool,
    pub bands_db: [f32; EQ_BAND_COUNT],
    pub preamp_db: f32,
}

impl Default for EqSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            bands_db: [0.0; EQ_BAND_COUNT],
            preamp_db: 0.0,
        }
    }
}

/// Same snapping and range as the webview's `clampBandGain`.
pub fn clamp_gain_db(gain_db: f32) -> f32 {
    if !gain_db.is_finite() {
        return 0.0;
    }
    ((gain_db * 10.0).round() / 10.0).clamp(-EQ_GAIN_LIMIT_DB, EQ_GAIN_LIMIT_DB)
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BiquadCoefficients {
    pub b0: f32,
    pub b1: f32,
    pub b2: f32,
    pub a1: f32,
    pub a2: f32,
}

impl BiquadCoefficients {
    pub const IDENTITY: Self = Self {
        b0: 1.0,
        b1: 0.0,
        b2: 0.0,
        a1: 0.0,
        a2: 0.0,
    };

    /// Peaking filter exactly as the Web Audio spec defines `BiquadFilterNode`.
    pub fn peaking(frequency_hz: f64, q: f64, gain_db: f64, sample_rate: f64) -> Self {
        // Above Nyquist the filter has no meaning; pass the signal through.
        if frequency_hz >= sample_rate / 2.0 || gain_db == 0.0 {
            return Self::IDENTITY;
        }
        let a = 10f64.powf(gain_db / 40.0);
        let w0 = TAU * frequency_hz / sample_rate;
        let alpha = w0.sin() / (2.0 * q);
        let cos_w0 = w0.cos();

        let b0 = 1.0 + alpha * a;
        let b1 = -2.0 * cos_w0;
        let b2 = 1.0 - alpha * a;
        let a0 = 1.0 + alpha / a;
        let a1 = -2.0 * cos_w0;
        let a2 = 1.0 - alpha / a;
        Self {
            b0: (b0 / a0) as f32,
            b1: (b1 / a0) as f32,
            b2: (b2 / a0) as f32,
            a1: (a1 / a0) as f32,
            a2: (a2 / a0) as f32,
        }
    }
}

/// Transposed direct form II state for one channel of one band.
#[derive(Debug, Clone, Copy, Default)]
struct BiquadState {
    z1: f32,
    z2: f32,
}

impl BiquadState {
    #[inline]
    fn process(&mut self, c: &BiquadCoefficients, x: f32) -> f32 {
        let y = c.b0 * x + self.z1;
        self.z1 = c.b1 * x - c.a1 * y + self.z2;
        self.z2 = c.b2 * x - c.a2 * y;
        y
    }
}

/// The EQ stage. Coefficients are computed when settings change (on a control
/// thread); `process` only multiplies.
pub struct Equalizer {
    settings: EqSettings,
    sample_rate: u32,
    coefficients: [BiquadCoefficients; EQ_BAND_COUNT],
    preamp: f32,
    states: [[BiquadState; EQ_BAND_COUNT]; MAX_EQ_CHANNELS],
    /// 0 = dry, 1 = fully EQ'd.
    wet: f32,
}

impl Equalizer {
    pub fn new(sample_rate: u32) -> Self {
        let mut eq = Self {
            settings: EqSettings::default(),
            sample_rate: sample_rate.max(1),
            coefficients: [BiquadCoefficients::IDENTITY; EQ_BAND_COUNT],
            preamp: 1.0,
            states: [[BiquadState::default(); EQ_BAND_COUNT]; MAX_EQ_CHANNELS],
            wet: 1.0,
        };
        eq.recompute();
        eq
    }

    pub fn set_sample_rate(&mut self, sample_rate: u32) {
        let sample_rate = sample_rate.max(1);
        if sample_rate != self.sample_rate {
            self.sample_rate = sample_rate;
            self.recompute();
            self.reset_state();
        }
    }

    pub fn apply(&mut self, settings: EqSettings) {
        let was_enabled = self.settings.enabled;
        self.settings = EqSettings {
            enabled: settings.enabled,
            bands_db: settings.bands_db.map(clamp_gain_db),
            preamp_db: clamp_gain_db(settings.preamp_db),
        };
        self.recompute();
        if !was_enabled && self.settings.enabled {
            // Stale filter memory from before the EQ was bypassed would click.
            self.reset_state();
        }
    }

    fn recompute(&mut self) {
        let rate = self.sample_rate as f64;
        for (index, coefficients) in self.coefficients.iter_mut().enumerate() {
            *coefficients = BiquadCoefficients::peaking(
                EQ_BAND_FREQUENCIES_HZ[index],
                FILTER_Q,
                self.settings.bands_db[index] as f64,
                rate,
            );
        }
        self.preamp = 10f32.powf(self.settings.preamp_db / 20.0);
    }

    fn reset_state(&mut self) {
        self.states = [[BiquadState::default(); EQ_BAND_COUNT]; MAX_EQ_CHANNELS];
    }

    /// True when `process` would change the signal (lets the mixer skip the work).
    pub fn is_active(&self) -> bool {
        self.settings.enabled || self.wet > 0.0
    }

    /// Filter interleaved audio in place.
    pub fn process(&mut self, data: &mut [f32], channels: usize) {
        if !self.is_active() || channels == 0 || channels > MAX_EQ_CHANNELS {
            return;
        }
        let target = if self.settings.enabled { 1.0 } else { 0.0 };
        let step = 1.0 / (BYPASS_BLEND_SECONDS * self.sample_rate as f32);
        for frame in data.chunks_exact_mut(channels) {
            if self.wet < target {
                self.wet = (self.wet + step).min(target);
            } else if self.wet > target {
                self.wet = (self.wet - step).max(target);
            }
            for (ch, sample) in frame.iter_mut().enumerate() {
                let dry = *sample;
                let mut wet = dry * self.preamp;
                for (band, coefficients) in self.coefficients.iter().enumerate() {
                    wet = self.states[ch][band].process(coefficients, wet);
                }
                *sample = dry + (wet - dry) * self.wet;
            }
        }
    }
}

/// Left/right gains for one stereo frame under the Web Audio panner law.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PanGains {
    /// out_l = in_l * l_from_l + in_r * l_from_r
    pub l_from_l: f32,
    pub l_from_r: f32,
    pub r_from_l: f32,
    pub r_from_r: f32,
}

impl PanGains {
    /// `StereoPannerNode` for a two-channel input.
    pub fn stereo(pan: f32) -> Self {
        let pan = pan.clamp(-1.0, 1.0) as f64;
        let x = if pan <= 0.0 { pan + 1.0 } else { pan };
        let gain_l = (x * FRAC_PI_2).cos() as f32;
        let gain_r = (x * FRAC_PI_2).sin() as f32;
        if pan <= 0.0 {
            Self {
                l_from_l: 1.0,
                l_from_r: gain_l,
                r_from_l: 0.0,
                r_from_r: gain_r,
            }
        } else {
            Self {
                l_from_l: gain_l,
                l_from_r: 0.0,
                r_from_l: gain_r,
                r_from_r: 1.0,
            }
        }
    }

    /// `StereoPannerNode` for a one-channel input (mono sources).
    pub fn mono(pan: f32) -> (f32, f32) {
        let pan = pan.clamp(-1.0, 1.0) as f64;
        let x = (pan + 1.0) / 2.0;
        ((x * FRAC_PI_2).cos() as f32, (x * FRAC_PI_2).sin() as f32)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(freq: f64, rate: u32, frames: usize) -> Vec<f32> {
        (0..frames)
            .map(|n| (TAU * freq * n as f64 / rate as f64).sin() as f32)
            .collect()
    }

    fn rms(samples: &[f32]) -> f32 {
        (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt()
    }

    /// Run a mono sine through the EQ as one channel and measure steady-state level.
    fn level_db(eq: &mut Equalizer, freq: f64, rate: u32) -> f32 {
        let input = sine(freq, rate, rate as usize);
        let mut data = input.clone();
        eq.process(&mut data, 1);
        let tail = &data[rate as usize / 2..];
        let reference = &input[rate as usize / 2..];
        20.0 * (rms(tail) / rms(reference)).log10()
    }

    #[test]
    fn peaking_coefficients_match_the_web_audio_formulas() {
        // Hand-computed from the spec for f=1 kHz, Q=1.4, +6 dB at 48 kHz.
        let c = BiquadCoefficients::peaking(1000.0, 1.4, 6.0, 48_000.0);
        let a = 10f64.powf(6.0 / 40.0);
        let w0 = TAU * 1000.0 / 48_000.0;
        let alpha = w0.sin() / 2.8;
        let a0 = 1.0 + alpha / a;
        assert!((c.b0 as f64 - (1.0 + alpha * a) / a0).abs() < 1e-6);
        assert!((c.b1 as f64 - (-2.0 * w0.cos()) / a0).abs() < 1e-6);
        assert!((c.b2 as f64 - (1.0 - alpha * a) / a0).abs() < 1e-6);
        assert!((c.a1 as f64 - (-2.0 * w0.cos()) / a0).abs() < 1e-6);
        assert!((c.a2 as f64 - (1.0 - alpha / a) / a0).abs() < 1e-6);
    }

    #[test]
    fn flat_band_is_identity() {
        assert_eq!(
            BiquadCoefficients::peaking(1000.0, 1.4, 0.0, 48_000.0),
            BiquadCoefficients::IDENTITY
        );
    }

    #[test]
    fn band_above_nyquist_is_bypassed() {
        assert_eq!(
            BiquadCoefficients::peaking(16_000.0, 1.4, 12.0, 22_050.0),
            BiquadCoefficients::IDENTITY
        );
    }

    #[test]
    fn boosting_a_band_raises_that_frequency_by_its_gain() {
        let mut eq = Equalizer::new(48_000);
        let mut settings = EqSettings::default();
        settings.bands_db[5] = 6.0; // 1 kHz
        eq.apply(settings);
        let boosted = level_db(&mut eq, 1000.0, 48_000);
        assert!((boosted - 6.0).abs() < 0.3, "boost at center: {boosted} dB");
    }

    #[test]
    fn a_boost_leaves_distant_frequencies_alone() {
        let mut eq = Equalizer::new(48_000);
        let mut settings = EqSettings::default();
        settings.bands_db[5] = 12.0;
        eq.apply(settings);
        let far = level_db(&mut eq, 63.0, 48_000);
        assert!(
            far.abs() < 0.5,
            "63 Hz unaffected by a 1 kHz boost: {far} dB"
        );
    }

    #[test]
    fn cutting_a_band_lowers_that_frequency() {
        let mut eq = Equalizer::new(48_000);
        let mut settings = EqSettings::default();
        settings.bands_db[2] = -9.0; // 125 Hz
        eq.apply(settings);
        let cut = level_db(&mut eq, 125.0, 48_000);
        assert!((cut + 9.0).abs() < 0.4, "cut at center: {cut} dB");
    }

    #[test]
    fn preamp_scales_the_whole_signal() {
        let mut eq = Equalizer::new(48_000);
        eq.apply(EqSettings {
            preamp_db: -6.0,
            ..EqSettings::default()
        });
        let level = level_db(&mut eq, 440.0, 48_000);
        assert!((level + 6.0).abs() < 0.2, "preamp -6 dB: {level}");
    }

    #[test]
    fn disabled_eq_bypasses_everything_including_preamp() {
        let mut eq = Equalizer::new(48_000);
        let mut settings = EqSettings {
            enabled: false,
            preamp_db: -12.0,
            ..EqSettings::default()
        };
        settings.bands_db[5] = 12.0;
        eq.apply(settings);
        // Let the enable blend settle, as it would a moment after toggling.
        let mut warm = vec![0.0; 2000];
        eq.process(&mut warm, 1);
        let level = level_db(&mut eq, 1000.0, 48_000);
        assert!(level.abs() < 0.01, "bypass is transparent: {level}");
        assert!(!eq.is_active(), "no work once fully bypassed");
    }

    #[test]
    fn toggling_the_eq_blends_instead_of_stepping() {
        let mut eq = Equalizer::new(48_000);
        eq.apply(EqSettings {
            preamp_db: -12.0,
            ..EqSettings::default()
        });
        let mut settle = vec![0.5; 4000];
        eq.process(&mut settle, 1);

        eq.apply(EqSettings {
            enabled: false,
            preamp_db: -12.0,
            ..EqSettings::default()
        });
        let mut data = vec![0.5; 1000];
        eq.process(&mut data, 1);
        let steps = data
            .windows(2)
            .map(|w| (w[1] - w[0]).abs())
            .fold(0.0, f32::max);
        assert!(steps < 0.05, "no audible step when disabling: {steps}");
        assert!((data[999] - 0.5).abs() < 1e-3, "ends dry");
    }

    #[test]
    fn channels_are_filtered_independently() {
        let mut eq = Equalizer::new(48_000);
        let mut settings = EqSettings::default();
        settings.bands_db[5] = 6.0;
        eq.apply(settings);
        let left = sine(1000.0, 48_000, 48_000);
        let mut data: Vec<f32> = left.iter().flat_map(|l| [*l, 0.0]).collect();
        eq.process(&mut data, 2);
        let right_peak = data
            .iter()
            .skip(1)
            .step_by(2)
            .fold(0.0f32, |m, s| m.max(s.abs()));
        assert_eq!(right_peak, 0.0, "silent channel stays silent");
    }

    #[test]
    fn gain_clamp_snaps_and_limits_like_the_webview() {
        assert_eq!(clamp_gain_db(3.17), 3.2);
        assert_eq!(clamp_gain_db(99.0), 12.0);
        assert_eq!(clamp_gain_db(-99.0), -12.0);
        assert_eq!(clamp_gain_db(f32::NAN), 0.0);
    }

    #[test]
    fn stereo_pan_center_is_identity() {
        assert_eq!(PanGains::stereo(0.0).l_from_l, 1.0);
        let g = PanGains::stereo(0.0);
        assert!(g.r_from_r > 0.999 && g.l_from_r.abs() < 1e-6 && g.r_from_l == 0.0);
    }

    #[test]
    fn stereo_pan_hard_left_folds_right_into_left() {
        let g = PanGains::stereo(-1.0);
        assert!((g.l_from_r - 1.0).abs() < 1e-6, "right input moves left");
        assert!(g.r_from_r.abs() < 1e-6, "right output silent");
        assert_eq!(g.l_from_l, 1.0);
    }

    #[test]
    fn stereo_pan_hard_right_folds_left_into_right() {
        let g = PanGains::stereo(1.0);
        assert!((g.r_from_l - 1.0).abs() < 1e-6);
        assert!(g.l_from_l.abs() < 1e-6);
        assert_eq!(g.r_from_r, 1.0);
    }

    #[test]
    fn mono_pan_is_equal_power() {
        let (l, r) = PanGains::mono(0.0);
        assert!((l - std::f32::consts::FRAC_1_SQRT_2).abs() < 1e-6);
        assert!((r - std::f32::consts::FRAC_1_SQRT_2).abs() < 1e-6);
        let (l, r) = PanGains::mono(-1.0);
        assert!((l - 1.0).abs() < 1e-6 && r.abs() < 1e-6);
        for pan in [-0.7f32, -0.2, 0.3, 0.9] {
            let (l, r) = PanGains::mono(pan);
            assert!(
                (l * l + r * r - 1.0).abs() < 1e-5,
                "constant power at {pan}"
            );
        }
    }
}
