namespace Kreoda.QuestFoundation;

/// <summary>World placement of the CAD model in the MR scene (§12.6): two
/// independent transforms — CAD model coordinates (mm, authoritative) and
/// the display transform owned by the client. Moving, rotating or scaling
/// the displayed model never modifies CAD geometry.</summary>
public sealed class DisplayTransform
{
    /// <summary>Display units per CAD millimeter (uniform scale).</summary>
    public double Scale { get; private set; } = 1.0;

    /// <summary>Display-space anchor of the CAD origin.</summary>
    public double[] Offset { get; } = new double[3];

    /// <summary>CAD point translated so the model center sits at origin
    /// before scaling (fit/rotate pivot). Default: no centering.</summary>
    public double[] CenterMm { get; } = new double[3];

    private DisplayTransform(double scale, double[] offset, double[] centerMm)
    {
        Scale = scale;
        Offset = offset;
        CenterMm = centerMm;
    }

    public static DisplayTransform FromScale(double displayPerMm) =>
        new(displayPerMm, new double[3], new double[3]);

    /// <summary>Named display scales (§12.6): model-unit magnification that
    /// never touches dimensions.</summary>
    public static DisplayTransform Preset(string name) => name switch
    {
        "1:10" => FromScale(0.1),
        "1:5" => FromScale(0.2),
        "1:1" => FromScale(1.0),
        "2:1" => FromScale(2.0),
        "10:1" => FromScale(10.0),
        _ => throw new ArgumentException($"unknown display preset: {name}", nameof(name)),
    };

    /// <summary>Fit the model's largest bbox extent into targetSize display
    /// units, centered on the bbox middle.</summary>
    public static DisplayTransform Fit(double[] bboxMinMm, double[] bboxMaxMm, double targetSize)
    {
        if (bboxMinMm.Length != 3 || bboxMaxMm.Length != 3)
            throw new ArgumentException("bbox must have 3 components");
        if (!(targetSize > 0) || !double.IsFinite(targetSize))
            throw new ArgumentException("targetSize must be positive finite", nameof(targetSize));
        var size = new double[3];
        var center = new double[3];
        for (var i = 0; i < 3; i++)
        {
            size[i] = bboxMaxMm[i] - bboxMinMm[i];
            center[i] = (bboxMaxMm[i] + bboxMinMm[i]) / 2.0;
            if (!(size[i] >= 0) || !double.IsFinite(size[i]) || !double.IsFinite(center[i]))
                throw new ArgumentException("bbox must be finite", nameof(bboxMinMm));
        }
        var max = Math.Max(size[0], Math.Max(size[1], size[2]));
        if (!(max > 0)) throw new ArgumentException("bbox has no extent", nameof(bboxMinMm));
        return new DisplayTransform(targetSize / max, new double[3], center);
    }

    public DisplayTransform WithOffset(double x, double y, double z) =>
        new(Scale, new[] { x, y, z }, (double[])CenterMm.Clone());

    /// <summary>CAD millimeters → display units.</summary>
    public double[] ToDisplay(double[] cadMm)
    {
        if (cadMm.Length != 3) throw new ArgumentException("point must have 3 components", nameof(cadMm));
        return new[]
        {
            (cadMm[0] - CenterMm[0]) * Scale + Offset[0],
            (cadMm[1] - CenterMm[1]) * Scale + Offset[1],
            (cadMm[2] - CenterMm[2]) * Scale + Offset[2],
        };
    }

    /// <summary>Display units → CAD millimeters (inverse; for placing
    /// spatial annotations back into model space).</summary>
    public double[] ToCad(double[] display)
    {
        if (display.Length != 3) throw new ArgumentException("point must have 3 components", nameof(display));
        return new[]
        {
            (display[0] - Offset[0]) / Scale + CenterMm[0],
            (display[1] - Offset[1]) / Scale + CenterMm[1],
            (display[2] - Offset[2]) / Scale + CenterMm[2],
        };
    }
}
