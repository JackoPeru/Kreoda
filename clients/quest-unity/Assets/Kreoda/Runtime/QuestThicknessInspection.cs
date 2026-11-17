using System;
using System.Text.Json;
using System.Globalization;

namespace Kreoda.QuestRuntime
{
    internal static class QuestThicknessInspection
    {
        internal static string Format(JsonElement envelope, string featureId)
        {
            FormatException Invalid() => new FormatException("Risposta spessore CAD non valida");
            if (!envelope.TryGetProperty("result", out var value) || value.ValueKind != JsonValueKind.Object ||
                !value.TryGetProperty("basis", out var basis) || basis.ValueKind != JsonValueKind.String || basis.GetString() != "occt-sampled-normal-rays" ||
                !value.TryGetProperty("isGlobalMinimum", out var global) || global.ValueKind != JsonValueKind.False ||
                !value.TryGetProperty("featureId", out var owner) || owner.ValueKind != JsonValueKind.String || owner.GetString() != featureId)
                throw Invalid();
            int Count(string name,int minimum,int maximum)
            {
                if (!value.TryGetProperty(name,out var item) || item.ValueKind != JsonValueKind.Number ||
                    !item.TryGetInt32(out var number) || number < minimum || number > maximum) throw Invalid();
                return number;
            }
            var requested=Count("requestedSamples",32,4096);
            Count("solidCount",1,128);
            var faces=Count("totalFaces",1,4096);var measuredFaces=Count("sampledFaces",0,faces);
            var attempted=Count("attemptedSamples",0,requested);var valid=Count("validSamples",0,attempted);
            var missed=Count("missedSamples",0,attempted);
            if (missed!=attempted-valid || measuredFaces>valid || !value.TryGetProperty("timeBudgetExceeded",out var timed) ||
                (timed.ValueKind!=JsonValueKind.True && timed.ValueKind!=JsonValueKind.False) ||
                !value.TryGetProperty("minimumThicknessMm",out var minimum) || !value.TryGetProperty("witness",out var witness)) throw Invalid();
            var title="Nessuna misura disponibile";
            if (valid==0) { if(minimum.ValueKind!=JsonValueKind.Null || witness.ValueKind!=JsonValueKind.Null)throw Invalid(); }
            else {
                if (minimum.ValueKind!=JsonValueKind.Number || !minimum.TryGetDouble(out var mm) || double.IsNaN(mm) || double.IsInfinity(mm) || mm<=0 ||
                    witness.ValueKind!=JsonValueKind.Object || !witness.TryGetProperty("pointAMm",out var a) || !witness.TryGetProperty("pointBMm",out var b) ||
                    a.ValueKind!=JsonValueKind.Array || b.ValueKind!=JsonValueKind.Array || a.GetArrayLength()!=3 || b.GetArrayLength()!=3) throw Invalid();
                double squared=0;
                for (var i=0;i<3;i++) {
                    if(a[i].ValueKind!=JsonValueKind.Number || b[i].ValueKind!=JsonValueKind.Number ||
                        !a[i].TryGetDouble(out var x) || !b[i].TryGetDouble(out var y) || double.IsNaN(x) || double.IsNaN(y) ||
                        double.IsInfinity(x) || double.IsInfinity(y))throw Invalid();
                    squared+=(x-y)*(x-y);
                }
                if (double.IsInfinity(squared) || Math.Abs(Math.Sqrt(squared)-mm)>Math.Max(1e-6,mm*1e-6))throw Invalid();
                title="Minimo rilevato "+mm.ToString("0.####",CultureInfo.InvariantCulture)+" mm";
            }
            var incomplete=missed>0 || measuredFaces<faces || timed.GetBoolean();
            return title+"\n"+valid+"/"+attempted+" misure · "+measuredFaces+"/"+faces+" facce\n"+
                (incomplete ? "Campionato · copertura incompleta" : "Campionato · minimo globale non garantito");
        }
    }
}
