Shader "Kreoda/SectionSurface"
{
    Properties
    {
        _Color ("Color", Color) = (.63, .71, .78, 1)
        _Cull ("Cull", Float) = 2
        _SectionEnabled ("Section Enabled", Float) = 0
        _SectionInverted ("Section Inverted", Float) = 0
        _SectionNormalLocal ("Section Normal (Local)", Vector) = (0, 1, 0, 0)
        _SectionOffsetLocal ("Section Offset (Local m)", Float) = 0
    }
    SubShader
    {
        Tags { "RenderType"="Opaque" "Queue"="Geometry" }
        Cull [_Cull]
        CGPROGRAM
        #pragma surface surf Standard fullforwardshadows addshadow vertex:vert
        #pragma multi_compile_instancing
        #include "UnityCG.cginc"
        fixed4 _Color;
        float _Cull, _SectionEnabled, _SectionInverted, _SectionOffsetLocal;
        float4 _SectionNormalLocal;
        struct Input { float3 sectionLocalPosition; };
        void vert(inout appdata_full vertex, out Input output)
        {
            UNITY_INITIALIZE_OUTPUT(Input, output);
            output.sectionLocalPosition = vertex.vertex.xyz;
        }
        void surf(Input input, inout SurfaceOutputStandard output)
        {
            float side = dot(_SectionNormalLocal.xyz, input.sectionLocalPosition) - _SectionOffsetLocal;
            clip(_SectionEnabled > .5 ? (_SectionInverted > .5 ? -side : side) : 1);
            output.Albedo = _Color.rgb;
            output.Alpha = _Color.a;
            output.Metallic = 0;
            output.Smoothness = .25;
        }
        ENDCG
    }
    FallBack "Standard"
}
