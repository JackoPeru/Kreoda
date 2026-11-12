using System.Text.Json;

namespace Kreoda.QuestFoundation;

public interface IVoiceClient : IDisposable
{
    Task<string> TranscribeAsync(byte[] wav, JsonElement context, CancellationToken ct = default);
    Task<VoiceReply> TalkAsync(string text, JsonElement context, CancellationToken ct = default);
    Task<VoiceAudio> SpeechAsync(string text, JsonElement context, CancellationToken ct = default);
}
