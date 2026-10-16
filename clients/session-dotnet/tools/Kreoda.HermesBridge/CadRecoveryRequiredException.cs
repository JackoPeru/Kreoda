using System.Text.Json;

namespace Kreoda.HermesBridge;

public sealed class CadRecoveryRequiredException(JsonElement recovery, bool persisted = false)
    : Exception("CAD rollback unconfirmed; reconcile the recorded transaction before continuing")
{
    public JsonElement Recovery { get; } = recovery.Clone();
    public bool RecoveryPersisted { get; } = persisted;
}
