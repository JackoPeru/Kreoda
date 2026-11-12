using System.Text.Json;

namespace Kreoda.ModelingAgent;

/// <summary>Human-verified measurements in image pixels. No automatic computer vision is implied.</summary>
public sealed record ReferenceCalibration(string SourceId, double PixelDistance, double KnownDistanceMm);
public sealed record ReferenceRectangle(double LeftPx, double TopPx, double RightPx, double BottomPx);

public static class ReferenceReconstruction
{
    /// <summary>Prepare an editable parametric sketch/extrusion from explicitly confirmed
    /// reference points and independently measured image scale. Caller must approve before execution.</summary>
    public static GeneratedCadOption Rectangle(ReferenceCalibration calibration, ReferenceRectangle bounds,
        double extrusionMm, AgentCommandCatalog catalog, GeneratedCadSelectionFence fence)
    {
        if(calibration is null || bounds is null || fence is null || catalog is null ||
            string.IsNullOrWhiteSpace(calibration.SourceId) || calibration.SourceId.Length>128 ||
            calibration.SourceId.Any(c=>!char.IsAsciiLetterOrDigit(c)&&c is not '-' and not '_') ||
            string.IsNullOrWhiteSpace(fence.SessionId) || string.IsNullOrWhiteSpace(fence.DocumentId) || fence.Revision<0)
            throw new ArgumentException("Explicit image identity and current document required");
        var values=new[] {calibration.PixelDistance,calibration.KnownDistanceMm,bounds.LeftPx,bounds.TopPx,
            bounds.RightPx,bounds.BottomPx,extrusionMm};
        if(values.Any(v=>!double.IsFinite(v)) || calibration.PixelDistance<=0 ||
            calibration.KnownDistanceMm<=0 || extrusionMm<=0 || extrusionMm>100000 ||
            bounds.RightPx<=bounds.LeftPx || bounds.BottomPx<=bounds.TopPx ||
            bounds.LeftPx<0 || bounds.TopPx<0 || bounds.RightPx>100000 || bounds.BottomPx>100000)
            throw new ArgumentOutOfRangeException(nameof(bounds),"Invalid or uncalibrated image coordinates");
        var scale=calibration.KnownDistanceMm/calibration.PixelDistance;
        var width=(bounds.RightPx-bounds.LeftPx)*scale;
        var height=(bounds.BottomPx-bounds.TopPx)*scale;
        if(!double.IsFinite(width)||!double.IsFinite(height)||width<0.01||height<0.01||width>100000||height>100000)
            throw new ArgumentOutOfRangeException(nameof(bounds),"Calibrated geometry exceeds native dimensions");
        var sketch=catalog.Require("CreateSketch");var extrude=catalog.Require("CreateExtrude");
        if(sketch.Creation.FixedCount!=1 || extrude.Creation.FixedCount!=1 ||
            !sketch.Parameters.GetProperty("properties").TryGetProperty("model",out _) ||
            !extrude.Parameters.GetProperty("properties").TryGetProperty("sketchId",out _))
            throw new ArgumentException("Current native CAD catalog cannot persist editable reference reconstruction");
        var model=new {
            points=new[] {new{id="p0",x=0d,y=0d,@fixed=false},new{id="p1",x=width,y=0d,@fixed=false},
                new{id="p2",x=width,y=height,@fixed=false},new{id="p3",x=0d,y=height,@fixed=false}},
            lines=new[] {new{id="l0",p1="p0",p2="p1"},new{id="l1",p1="p1",p2="p2"},
                new{id="l2",p1="p2",p2="p3"},new{id="l3",p1="p3",p2="p0"}},
            circles=Array.Empty<object>(),arcs=Array.Empty<object>(),constraints=Array.Empty<object>()};
        return new("reference-rectangle-"+calibration.SourceId,
            $"User-confirmed rectangle from reference {calibration.SourceId}; {width:G6} × {height:G6} mm at {scale:G6} mm/pixel; depth {extrusionMm:G6} mm. No unverified image inference.",[
                new("CreateSketch",JsonSerializer.SerializeToElement(new {planeKind="XY",model}),
                    "Four manually verified image corners converted with independently supplied calibration", "referenceSketch"),
                new("CreateExtrude",JsonSerializer.SerializeToElement(new {sketchId="$referenceSketch",distanceMm=extrusionMm}),
                    "Normal editable native extrusion of calibrated rectangle", "result")],fence);
    }
}
