using System;
using System.Globalization;
using System.Text.Json;

namespace Kreoda.QuestRuntime
{
    internal static class QuestMassInspection
    {
        internal static string Format(JsonElement envelope)
        {
            if (!envelope.TryGetProperty("result", out var result) || result.ValueKind != JsonValueKind.Object ||
                !result.TryGetProperty("basis", out var basis) || basis.GetString() != "brep")
                throw new FormatException("Risposta geometrica non valida");
            double Read(string name)
            {
                if (!result.TryGetProperty(name, out var field) || !field.TryGetDouble(out var number) ||
                    double.IsNaN(number) || double.IsInfinity(number) || number < 0)
                    throw new FormatException("Proprietà CAD non valida: " + name);
                return number;
            }
            var volume = Read("volumeMm3");
            var area = Read("areaMm2");
            var mass = Read("massKg");
            var density = Read("densityKgPerM3");
            if (!result.TryGetProperty("centroidMm", out var centroid) || centroid.ValueKind != JsonValueKind.Array || centroid.GetArrayLength() != 3)
                throw new FormatException("Baricentro CAD non valido");
            var values = new double[3];
            for (var i = 0; i < 3; i++)
            {
                if (!centroid[i].TryGetDouble(out values[i]) || double.IsNaN(values[i]) || double.IsInfinity(values[i]))
                    throw new FormatException("Baricentro CAD non finito");
            }
            string Number(double value) => value.ToString("0.###", CultureInfo.InvariantCulture);
            return "Volume " + Number(volume) + " mm³ · Area " + Number(area) + " mm²\n" +
                "Baricentro (" + Number(values[0]) + ", " + Number(values[1]) + ", " + Number(values[2]) + ") mm\n" +
                (density == 0 ? "Massa non calcolata · densità non assegnata" : "Massa " + Number(mass) + " kg · " + Number(density) + " kg/m³");
        }
    }
}
