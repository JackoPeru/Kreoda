Shader "Kreoda/QuestUi"
{
    Properties
    {
        _Color ("Color", Color) = (0.94, 0.96, 0.98, 0.78)
        _Radius ("Corner radius", Range(0.001, 0.5)) = 0.11
        _Aspect ("Aspect (width/height)", Float) = 1
        _BorderColor ("Hairline color", Color) = (0.90, 0.93, 1.0, 0.10)
        _BorderSize ("Hairline width", Range(0, 0.06)) = 0.0045
        _Sheen ("Surface light", Range(0, 1)) = 0.14
    }
    SubShader
    {
        Tags { "Queue"="Transparent" "RenderType"="Transparent" "IgnoreProjector"="True" }
        Blend SrcAlpha OneMinusSrcAlpha
        ZWrite Off
        ZTest LEqual
        Cull Off
        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_instancing
            #include "UnityCG.cginc"

            fixed4 _Color;
            float _Radius;
            float _Aspect;
            fixed4 _BorderColor;
            float _BorderSize;
            float _Sheen;

            struct appdata { float4 vertex : POSITION; float2 uv : TEXCOORD0; UNITY_VERTEX_INPUT_INSTANCE_ID };
            struct v2f
            {
                float4 vertex : SV_POSITION;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_OUTPUT_STEREO
            };

            v2f vert(appdata v)
            {
                v2f o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_INITIALIZE_OUTPUT(v2f, o);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                o.vertex = UnityObjectToClipPos(v.vertex);
                o.uv = v.uv;
                return o;
            }

            fixed4 frag(v2f i) : SV_Target
            {
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
                // Cubes have UVs on all six faces. Only the front face is
                // visible for our thin MR quads; smooth derivatives prevent
                // pixel-staircase edges at headset resolution. The aspect
                // rescale keeps corner radii and hairlines metric-uniform on
                // wide bars and small square tiles alike.
                float2 uv = float2(i.uv.x * _Aspect, i.uv.y);
                float2 halfSize = float2(_Aspect, 1.0) * 0.5;
                float2 q = abs(uv - halfSize) - (halfSize - _Radius);
                float distance = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - _Radius;
                float feather = max(fwidth(distance) * 1.25, .001);
                float coverage = 1.0 - smoothstep(-feather, feather, distance);
                // Calm translucent material: no simulated environment,
                // spectral bands or bevels behind text. Alpha remains local
                // to each rounded panel, so the room fills the open space.
                float stroke = 1.0 - smoothstep(0.0, max(_BorderSize, 0.0001), -distance);
                float trim = saturate(stroke * _BorderColor.a);
                fixed4 result = _Color;
                result.rgb += smoothstep(.15, 1.0, i.uv.y) * _Sheen * .14;
                result.rgb = lerp(result.rgb, _BorderColor.rgb, trim);
                result.a = saturate(_Color.a + (1.0 - _Color.a) * trim * .12) * coverage;
                return result;
            }
            ENDCG
        }
    }
}
