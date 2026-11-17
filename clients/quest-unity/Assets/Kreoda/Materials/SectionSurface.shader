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
        _ZebraEnabled ("Zebra Enabled", Float) = 0
        _ZebraBands ("Zebra Bands", Float) = 16
        _ZebraAxisWorld ("Zebra Environment Axis", Vector) = (1, 0, 0, 0)
        _CurvatureEnabled ("Curvature Enabled", Float) = 0
        _CurvatureMaximumPerMm ("Curvature Scale (1/mm)", Float) = .1
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
        float _ZebraEnabled, _ZebraBands;
        float4 _ZebraAxisWorld;
        float _CurvatureEnabled, _CurvatureMaximumPerMm;
        struct Input { float3 sectionLocalPosition; float3 worldNormal; float3 worldPos; float curvature; };
        void vert(inout appdata_full vertex, out Input output)
        {
            UNITY_INITIALIZE_OUTPUT(Input, output);
            output.sectionLocalPosition = vertex.vertex.xyz;
            output.curvature = vertex.texcoord2.x;
        }
        void surf(Input input, inout SurfaceOutputStandard output)
        {
            float side = dot(_SectionNormalLocal.xyz, input.sectionLocalPosition) - _SectionOffsetLocal;
            clip(_SectionEnabled > .5 ? (_SectionInverted > .5 ? -side : side) : 1);
            output.Albedo = _Color.rgb;
            output.Alpha = _Color.a;
            output.Metallic = 0;
            output.Smoothness = .25;
            if (_CurvatureEnabled > .5)
            {
                float t = saturate(input.curvature / _CurvatureMaximumPerMm);
                float3 blue = float3(.12, .32, .95), green = float3(.10, .80, .55), red = float3(.95, .18, .12);
                float3 heat = t < .5 ? lerp(blue, green, t * 2) : lerp(green, red, (t - .5) * 2);
                if (input.curvature < 0) heat = .38;
                output.Emission = lerp(heat, _Color.rgb, .14);
                output.Albedo = 0;
                output.Metallic = 1;
                output.Smoothness = 0;
            }
            else if (_ZebraEnabled > .5)
            {
                float3 reflected = reflect(-normalize(UnityWorldSpaceViewDir(input.worldPos)), normalize(input.worldNormal));
                float wave = sin(dot(reflected, _ZebraAxisWorld.xyz) * _ZebraBands * UNITY_PI);
                float aa = max(fwidth(wave), .001);
                float band = smoothstep(-aa, aa, wave);
                output.Emission = lerp(.012, lerp(1.0, _Color.rgb, .18), band);
                output.Albedo = 0;
                output.Metallic = 1;
                output.Smoothness = 0;
            }
        }
        ENDCG
    }
    FallBack "Standard"
}
