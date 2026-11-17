using System.Text;

namespace Kreoda.QuestFoundation;

public sealed record VoiceAudio(float[] Samples, int SampleRate, int Channels);
public sealed record VoiceAudioInfo(int SampleRate, int Channels, int Format, int Bits, int DataOffset, int DataBytes);

/// <summary>Bounded WAV PCM16 microphone input and PCM16/float32 service playback.</summary>
public static class VoiceWave
{
    public static byte[] EncodeMono(float[] samples, int sampleRate)
    {
        if (samples is null || samples.Length == 0 || sampleRate < 8000 || sampleRate > 48000 || samples.Length > sampleRate * 30)
            throw new ArgumentException("Microphone audio must contain at most thirty seconds");
        using var stream = new MemoryStream(44 + samples.Length * 2);
        using var writer = new BinaryWriter(stream, Encoding.ASCII, true);
        writer.Write(Encoding.ASCII.GetBytes("RIFF"));writer.Write(36 + samples.Length * 2);writer.Write(Encoding.ASCII.GetBytes("WAVEfmt "));
        writer.Write(16);writer.Write((short)1);writer.Write((short)1);writer.Write(sampleRate);writer.Write(sampleRate * 2);
        writer.Write((short)2);writer.Write((short)16);writer.Write(Encoding.ASCII.GetBytes("data"));writer.Write(samples.Length * 2);
        foreach (var sample in samples) {
            if (float.IsNaN(sample) || float.IsInfinity(sample)) throw new ArgumentException("Nonfinite microphone sample");
            writer.Write((short)Math.Round(Math.Max(-1, Math.Min(1, sample)) * 32767));
        }
        return stream.ToArray();
    }
    static uint U32(byte[] bytes, int offset) => (uint)(bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16 | bytes[offset + 3] << 24);
    static int U16(byte[] bytes, int offset) => bytes[offset] | bytes[offset + 1] << 8;
    public static VoiceAudioInfo Inspect(byte[] wav, double maxSeconds)
    {
        if (wav is null || wav.Length < 44 || wav.Length > 4194304 || double.IsNaN(maxSeconds) || double.IsInfinity(maxSeconds) || maxSeconds <= 0 ||
            Encoding.ASCII.GetString(wav, 0, 4) != "RIFF" || Encoding.ASCII.GetString(wav, 8, 4) != "WAVE" || U32(wav, 4) != wav.Length - 8)
            throw new ArgumentException("Invalid bounded WAV container");
        var offset = 12;var chunks = 0;var format = 0;var channels = 0;var rate = 0;var bits = 0;var alignment = 0;var data = -1;var dataBytes = 0;
        while (offset < wav.Length) {
            if (++chunks > 64 || wav.Length - offset < 8) throw new ArgumentException("Invalid WAV chunk header");
            var name = Encoding.ASCII.GetString(wav, offset, 4);var length = U32(wav, offset + 4);offset += 8;
            if (length > wav.Length - offset) throw new ArgumentException("Truncated WAV chunk");
            if (name == "fmt ") {
                if (format != 0 || length < 16) throw new ArgumentException("Invalid WAV format chunk");
                format = U16(wav, offset);channels = U16(wav, offset + 2);rate = (int)U32(wav, offset + 4);
                alignment = U16(wav, offset + 12);bits = U16(wav, offset + 14);
                if (U32(wav, offset + 8) != (long)rate * alignment) throw new ArgumentException("Inconsistent WAV byte rate");
            } else if (name == "data") {
                if (data >= 0) throw new ArgumentException("Multiple WAV data chunks");
                data = offset;dataBytes = (int)length;
            }
            var padded = (long)offset + length + (length & 1);
            if (padded > wav.Length) throw new ArgumentException("Missing WAV chunk padding");
            offset = (int)padded;
        }
        if (channels is < 1 or > 2 || rate is < 8000 or > 96000 || !((format == 1 && bits == 16) || (format == 3 && bits == 32)) ||
            alignment != channels * bits / 8 || data < 0 || dataBytes <= 0 || dataBytes % alignment != 0 ||
            (double)dataBytes / alignment / rate > maxSeconds)
            throw new ArgumentException("Unsupported WAV format or duration");
        return new(rate, channels, format, bits, data, dataBytes);
    }
    public static VoiceAudio Decode(byte[] wav, double maxSeconds = 120)
    {
        var info = Inspect(wav, maxSeconds);var width = info.Bits / 8;var samples = new float[info.DataBytes / width];
        for (var i = 0; i < samples.Length; i++) {
            var offset = info.DataOffset + i * width;
            var sample = info.Format == 1 ? (short)U16(wav, offset) / 32768f : BitConverter.ToSingle(wav, offset);
            if (float.IsNaN(sample) || float.IsInfinity(sample)) throw new ArgumentException("Nonfinite service audio sample");
            samples[i] = Math.Max(-1, Math.Min(1, sample));
        }
        return new(samples, info.SampleRate, info.Channels);
    }
}
