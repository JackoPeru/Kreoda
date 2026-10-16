using System.Text.Json;
namespace Kreoda.ModelingAgent.Benchmark;
public static class GeometryCheck
{
    const double DimensionTolerance = .001, VolumeTolerance = .01;
    public static string[] Evaluate(JsonElement fixture, JsonElement model, JsonElement validation, JsonElement bounds, JsonElement faces)
    {
        var failures = new List<string>();
        void Check(bool ok, string name) { if (!ok) failures.Add(name); }
        Check(Bool(validation,"valid") && Array(validation,"checks").Length>0 && Array(validation,"checks").All(c=>Bool(c,"ok")),"native-validation");
        Check(model.TryGetProperty("requestActive",out var active) && active.ValueKind==JsonValueKind.False,"committed");
        var bodies=Array(model,"bodies");var features=Array(model,"features");
        Check(bodies.Length==1 && features.Length>0 && !features.Any(f=>Text(f,"type")=="Instance"),"one-visible-body");
        Check(bounds.ValueKind==JsonValueKind.Object && bounds.TryGetProperty("solidCount",out var solids) && solids.ValueKind==JsonValueKind.Number && solids.TryGetInt32(out var solidCount) && solidCount==1,"one-brep-solid");
        var bbox=Numbers(bounds,"bboxMm",6);var sizes=Numbers(fixture,"bboxSizeMm",3);
        Check(bbox.Length==6 && sizes.Length==3 && Enumerable.Range(0,3).All(i=>Near(bbox[i+3]-bbox[i],sizes[i])),"bbox");
        Check(Near(Number(bounds,"volumeMm3"),Number(fixture,"volumeMm3"),VolumeTolerance),"volume");
        var all=Array(faces,"faces");
        Check(all.Length>0 && all.All(f=>double.IsFinite(Number(f,"areaMm2")) && Number(f,"areaMm2")>0 && Numbers(f,"bboxMm",6).Length==6),"finite-faces");
        var cylinders=all.Where(f=>Text(f,"surfaceType")=="cylinder" && Text(f,"orientation")=="reversed").ToArray();
        var unique=new List<JsonElement>();
        foreach(var f in cylinders) {
            if(Numbers(f,"axis",3).Length!=3 || Numbers(f,"originMm",3).Length!=3 || !double.IsFinite(Number(f,"radiusMm"))) { Check(false,"holes");continue; }
            if(!unique.Any(g=>SameCylinder(f,g)))unique.Add(f);
        }
        var expected=Array(fixture,"holes");
        Check(unique.Count==expected.Length && expected.All(h=>unique.Any(f=>HoleMatches(h,f))),"holes");
        // Hole walls must span the material, including the enclosure's 2 mm bottom.
        var depth=Text(fixture,"id")=="simple-enclosure"?2:sizes.ElementAtOrDefault(2);
        Check(expected.All(h=>{
            var matching=cylinders.Where(f=>HoleMatches(h,f)).Select(f=>Numbers(f,"bboxMm",6)).Where(b=>b.Length==6).ToArray();
            return bbox.Length==6 && matching.Length>0 && Near(matching.Min(b=>b[2]),bbox[2]) && Near(matching.Max(b=>b[5]),bbox[2]+depth);
        }),"hole-through-depth");
        foreach(var key in new[]{"expectedPlaneCoordinates","windowPlanes"}) {
            if(!fixture.TryGetProperty(key,out var required))continue;
            foreach(var axis in new[]{"x","y","z"}) {
                if(!required.TryGetProperty(axis,out var coords))continue;
                var i=axis=="x"?0:axis=="y"?1:2;
                var planes=all.Where(f=>Text(f,"surfaceType")=="plane" && AxisAligned(Numbers(f,"normal",3),i)).Select(f=>Numbers(f,"originMm",3)).Where(o=>o.Length==3).Select(o=>o[i]).ToArray();
                Check(coords.ValueKind==JsonValueKind.Array && coords.EnumerateArray().All(c=>c.TryGetDouble(out var v)&&double.IsFinite(v)&&planes.Any(p=>Near(p,v))),"interior-planes-"+axis);
            }
        }
        if(fixture.TryGetProperty("topAreaMm2",out _)) {
            var top=all.Where(f=>Text(f,"surfaceType")=="plane" && AxisAligned(Numbers(f,"normal",3),2) && bbox.Length==6 && Numbers(f,"originMm",3).Length==3 && Near(Numbers(f,"originMm",3)[2],bbox[5])).Sum(f=>Number(f,"areaMm2"));
            Check(Near(top,Number(fixture,"topAreaMm2"),VolumeTolerance),"open-top-area");
        }
        if(fixture.TryGetProperty("chamferDistanceMm",out _)) {
            var cones=all.Where(f=>Text(f,"surfaceType")=="cone").ToArray();var d=Number(fixture,"chamferDistanceMm");
            Check(cones.Length==2 && bbox.Length==6 && cones.All(f=>Near(Math.Abs(Number(f,"semiAngleDeg")),45) && AxisAligned(Numbers(f,"axis",3),2)) &&
                cones.Any(f=>Terminal(f,bbox[2],bbox[2]+d)) && cones.Any(f=>Terminal(f,bbox[5]-d,bbox[5])),"terminal-chamfers");
        }
        return failures.Distinct().ToArray();
    }
    static bool Terminal(JsonElement f,double low,double high) { var b=Numbers(f,"bboxMm",6);return b.Length==6&&Near(b[2],low)&&Near(b[5],high); }
    static bool HoleMatches(JsonElement h,JsonElement f) {
        var wanted=Numbers(h,"centerXY",2);var actual=Numbers(f,"originMm",3);
        return wanted.Length==2&&actual.Length==3&&AxisAligned(Numbers(f,"axis",3),2)&&Near(wanted[0],actual[0])&&Near(wanted[1],actual[1])&&Near(Number(h,"radiusMm"),Number(f,"radiusMm"));
    }
    static bool SameCylinder(JsonElement f,JsonElement g) {
        var a=Numbers(f,"originMm",3);var b=Numbers(g,"originMm",3);
        return a.Length==3&&b.Length==3&&AxisAligned(Numbers(f,"axis",3),2)&&AxisAligned(Numbers(g,"axis",3),2)&&Near(a[0],b[0])&&Near(a[1],b[1])&&Near(Number(f,"radiusMm"),Number(g,"radiusMm"));
    }
    static bool AxisAligned(double[] a,int i) => a.Length==3&&Near(Math.Abs(a[i]),1)&&Enumerable.Range(0,3).Where(j=>j!=i).All(j=>Near(a[j],0));
    static bool Near(double a,double b,double tolerance=DimensionTolerance) => double.IsFinite(a)&&double.IsFinite(b)&&Math.Abs(a-b)<=tolerance;
    public static JsonElement[] Array(JsonElement value,string key) => value.ValueKind==JsonValueKind.Object&&value.TryGetProperty(key,out var a)&&a.ValueKind==JsonValueKind.Array?a.EnumerateArray().ToArray():[];
    public static string? Text(JsonElement value,string key) => value.ValueKind==JsonValueKind.Object&&value.TryGetProperty(key,out var s)&&s.ValueKind==JsonValueKind.String?s.GetString():null;
    static bool Bool(JsonElement value,string key) => value.ValueKind==JsonValueKind.Object&&value.TryGetProperty(key,out var b)&&b.ValueKind==JsonValueKind.True;
    static double Number(JsonElement value,string key) => value.ValueKind==JsonValueKind.Object&&value.TryGetProperty(key,out var n)&&n.ValueKind==JsonValueKind.Number&&n.TryGetDouble(out var d)?d:double.NaN;
    static double[] Numbers(JsonElement value,string key,int count) {
        var a=Array(value,key);if(a.Length!=count)return [];
        var result=new double[count];for(var i=0;i<count;i++)if(a[i].ValueKind!=JsonValueKind.Number||!a[i].TryGetDouble(out result[i])||!double.IsFinite(result[i]))return [];
        return result;
    }
}
