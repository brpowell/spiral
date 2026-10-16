//! cpal-backed [`StreamFactory`]: CoreAudio on macOS, WASAPI on Windows, ALSA on Linux.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SampleFormat, SizedSample};

use super::output::{ActiveStream, ErrorSink, Render, StreamFactory, StreamInfo};

pub struct CpalFactory;

struct CpalStream(cpal::Stream);

impl ActiveStream for CpalStream {
    fn start(&self) -> Result<(), String> {
        self.0.play().map_err(|err| err.to_string())
    }
}

impl StreamFactory for CpalFactory {
    fn build(
        &mut self,
        render: Render,
        on_error: ErrorSink,
    ) -> Result<(Box<dyn ActiveStream>, StreamInfo), String> {
        // Re-resolve the default device on every build: that is the whole point
        // of rebuilding after wake or a device switch.
        let host = cpal::default_host();
        let device = host
            .default_output_device()
            .ok_or_else(|| "no default output device".to_string())?;
        let supported = device
            .default_output_config()
            .map_err(|err| format!("default output config: {err}"))?;
        let config = supported.config();
        let channels = config.channels as usize;
        let info = StreamInfo {
            sample_rate: config.sample_rate,
            channels,
            device: device
                .description()
                .map(|description| description.to_string())
                .unwrap_or_else(|_| "unknown".into()),
        };

        let err_fn = move |err: cpal::Error| on_error(err.to_string());
        let stream = match supported.sample_format() {
            SampleFormat::F32 => {
                let mut render = render;
                device.build_output_stream(
                    config,
                    move |data: &mut [f32], _| render(data),
                    err_fn,
                    None,
                )
            }
            SampleFormat::I16 => build_converted::<i16>(&device, config, render, err_fn),
            SampleFormat::I32 => build_converted::<i32>(&device, config, render, err_fn),
            SampleFormat::U16 => build_converted::<u16>(&device, config, render, err_fn),
            other => return Err(format!("unsupported device sample format {other:?}")),
        }
        .map_err(|err| format!("build stream: {err}"))?;

        Ok((Box::new(CpalStream(stream)), info))
    }
}

fn build_converted<T>(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    mut render: Render,
    err_fn: impl FnMut(cpal::Error) + Send + 'static,
) -> Result<cpal::Stream, cpal::Error>
where
    T: SizedSample + FromSample<f32> + Send + 'static,
{
    let mut scratch: Vec<f32> = Vec::new();
    device.build_output_stream(
        config,
        move |data: &mut [T], _| {
            if scratch.len() < data.len() {
                scratch.resize(data.len(), 0.0);
            }
            let block = &mut scratch[..data.len()];
            render(block);
            for (out, sample) in data.iter_mut().zip(block.iter()) {
                *out = T::from_sample(*sample);
            }
        },
        err_fn,
        None,
    )
}
