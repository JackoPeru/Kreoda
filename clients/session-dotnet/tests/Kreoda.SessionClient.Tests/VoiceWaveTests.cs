using System.Text;
using Kreoda.QuestFoundation;
using Xunit;

namespace Kreoda.SessionClient.Tests;

public sealed class VoiceWaveTests
{
    [Fact]
    public void MicrophonePcmRoundTripsWithBoundedSamplesAndRealUnits()
    {
        var samples = new[] { -1f, -.5f, 0, .5f, 1f };
        var wave = VoiceWave.EncodeMono(samples, 16000);
        var decoded = VoiceWave.Decode(wave, 1);
        Assert.Equal(16000, decoded.SampleRate);Assert.Equal(1, decoded.Channels);
        Assert.Equal(samples.Length, decoded.Samples.Length);
        for (var i = 0; i < samples.Length; i++) Assert.InRange(Math.Abs(samples[i] - decoded.Samples[i]), 0, .00004);
    }
    [Fact]
    public void InvalidDurationAndTruncatedChunkCannotAllocatePlayback()
    {
        var wave = VoiceWave.EncodeMono(new float[16000], 16000);
        Assert.Throws<ArgumentException>(() => VoiceWave.Decode(wave, .5));
        var truncated = wave.Take(wave.Length - 1).ToArray();
        Assert.Throws<ArgumentException>(() => VoiceWave.Decode(truncated, 30));
        wave[40] = 255;wave[41] = 255;wave[42] = 255;wave[43] = 127;
        Assert.Throws<ArgumentException>(() => VoiceWave.Decode(wave, 30));
    }
    [Fact]
    public void NonfiniteMicAndCompressedWaveFailExplicitly()
    {
        Assert.Throws<ArgumentException>(() => VoiceWave.EncodeMono(new[] { float.NaN }, 16000));
        var wave = VoiceWave.EncodeMono(new[] { 0f }, 16000);wave[20] = 6;
        Assert.Throws<ArgumentException>(() => VoiceWave.Decode(wave, 30));
    }
}
