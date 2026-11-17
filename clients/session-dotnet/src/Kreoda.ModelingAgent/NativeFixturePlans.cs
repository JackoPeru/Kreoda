using System.Text.Json;

namespace Kreoda.ModelingAgent;

/// <summary>Deterministic native-command baseline for the frozen seven CAD shapes; not an LLM benchmark.</summary>
public static class NativeFixturePlans
{
    public static GeneratedCadOption Build(string fixtureId, AgentCommandCatalog catalog)
    {
        var steps = new List<GeneratedCadStep>();
        void Add(string command, string alias, object payload, string why) {
            catalog.Require(command);
            steps.Add(new(command, JsonSerializer.SerializeToElement(payload), why, alias));
        }
        void HideCutter(string toolAlias) {
            catalog.Require("SetBodyVisibility");
            steps.Add(new("SetBodyVisibility", JsonSerializer.SerializeToElement(new {
                bodyId="$toolbody:"+toolAlias, visible=false }),
                "Hide only the native cutter body identified by authoritative current body history"));
        }
        object Rectangle(double x0,double y0,double x1,double y1) {
            var xy = new[] { (x0,y0),(x1,y0),(x1,y1),(x0,y1) };
            return new {points=xy.Select((p,i)=>new {id=$"p{i}",x=p.Item1,y=p.Item2,@fixed=false}).ToArray(),
                lines=Enumerable.Range(0,4).Select(i=>new {id=$"l{i}",p1=$"p{i}",p2=$"p{(i+1)%4}"}).ToArray(),
                circles=Array.Empty<object>(),arcs=Array.Empty<object>(),constraints=Array.Empty<object>()};
        }
        switch (fixtureId)
        {
            case "u-bracket": return GenerativeIntent.Bracket("U",100,40,60,5,catalog);
            case "centered-hole-plate":
                Add("CreateBox","base",new {widthMm=100d,heightMm=80d,depthMm=5d},"Native plate");
                Add("CreateHole","result",new {targetId="$base",faceRole="box.+Z",xMm=50d,yMm=40d,
                    diameterMm=10d,depthMode="throughAll",depthMm=0d},"Canonical through hole in plate");
                break;
            case "six-hole-flange":
                Add("CreateCylinder","base",new {radiusMm=50d,heightMm=10d},"Native flange");
                for(var i=0;i<6;i++) {
                    var angle=i*Math.PI/3;
                    Add("CreateHole",i==5?"result":"hole"+i,new {targetId=i==0?"$base":"$hole"+(i-1),faceRole=i==0?"cyl.+Z":"box.+Z",
                        xMm=35*Math.Cos(angle),yMm=35*Math.Sin(angle),diameterMm=8d,
                        depthMode="throughAll",depthMm=0d},"Canonical flange bolt hole");
                }
                break;
            case "hollow-box":
            case "simple-enclosure":
                var small=fixtureId=="simple-enclosure";
                var width=small?120d:100d;var depth=80d;var height=small?30d:50d;var wall=small?2d:3d;
                Add("CreateBox","base",new {widthMm=width,heightMm=depth,depthMm=height},"Native box with bottom");
                Add("CreateDatumPlane","cavityPlane",new {definition=new {type="offset",@base=new {type="principal",planeKind="XY"},offsetMm=wall}},"Offset floor plane");
                Add("CreateSketch","cavitySketch",new {supportRef="$cavityPlane",model=Rectangle(wall,wall,width-wall,depth-wall)},"Editable cavity footprint");
                Add("CreateExtrude","cavityTool",new {sketchId="$cavitySketch",distanceMm=height-wall},"Cavity above floor");
                Add("CreateBoolean","cavityResult",new {op="cut",targetId="$base",toolId="$cavityTool"},"Open-top solid with floor");
                HideCutter("cavityTool");
                if(small) {
                    Add("CreateHole","floorHole0Result",new {targetId="$cavityResult",faceRole="box.-Z",
                        xMm=10d,yMm=10d,diameterMm=4d,depthMode="throughAll",depthMm=0d},"Native first through-bottom hole");
                    Add("CreateHole","floorHole1Result",new {targetId="$floorHole0Result",faceRole="box.-Z",
                        xMm=110d,yMm=70d,diameterMm=4d,depthMode="throughAll",depthMm=0d},"Native second through-bottom hole");
                }
                break;
            case "mounting-plate":
                // Two closed sketch loops make the center window without a separate
                // cutter. The four bolt holes are native CreateHole features, whose
                // cylindrical walls preserve the frozen reversed-hole topology.
                var mountingPoints=new List<object>();var mountingLines=new List<object>();
                void MountRectangle(string prefix,double x0,double y0,double x1,double y1) {
                    var xy=new[] {(x0,y0),(x1,y0),(x1,y1),(x0,y1)};
                    for(var i=0;i<4;i++) {
                        mountingPoints.Add(new {id=prefix+"p"+i,x=xy[i].Item1,y=xy[i].Item2,@fixed=false});
                        mountingLines.Add(new {id=prefix+"l"+i,p1=prefix+"p"+i,p2=prefix+"p"+((i+1)%4)});
                    }
                }
                MountRectangle("outer",0,0,140,90);
                MountRectangle("window",55,35,85,55);
                var coords=new[] {(10d,10d),(130d,10d),(10d,80d),(130d,80d)};
                Add("CreateSketch","profile",new {planeKind="XY",model=new {points=mountingPoints,lines=mountingLines,
                    circles=Array.Empty<object>(),arcs=Array.Empty<object>(),constraints=Array.Empty<object>()}},
                    "Parametric sketch with outside boundary and closed rectangular center window");
                Add("CreateExtrude","blank",new {sketchId="$profile",distanceMm=6d},
                    "Native plate with center window and one solid");
                var mountTip="blank";
                for(var i=0;i<coords.Length;i++) {
                    var alias=i==coords.Length-1?"result":"mountHole"+i;
                    Add("CreateHole",alias,new {targetId="$"+mountTip,
                        faceRole=i==0?"extrude.+Z":"box.+Z",
                        xMm=coords[i].Item1,yMm=coords[i].Item2,
                        diameterMm=6d,depthMode="throughAll",depthMm=0d},
                        "Native editable bolt hole with canonical reversed cylindrical wall");
                    mountTip=alias;
                }
                break;
            case "chamfered-shaft":
                Add("CreateCylinder","base",new {radiusMm=10d,heightMm=100d},"Editable native shaft");
                Add("CreateChamfer","result",new {targetId="$base",edgeIds=new[] {"$terminal-circle-edges"},distanceMm=1d},
                    "Resolved terminal edge identities from native topology, never guessed");
                break;
            default: throw new ArgumentException("Unknown frozen benchmark fixture",nameof(fixtureId));
        }
        if(steps.Count>64) throw new InvalidOperationException("Fixture exceeded frozen action budget");
        return new(fixtureId,"Deterministic editable native CAD baseline; no Hermes LLM",steps.AsReadOnly());
    }
}
