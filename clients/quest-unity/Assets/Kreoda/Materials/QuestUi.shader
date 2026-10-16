Shader "Kreoda/QuestUi"
{
    Properties
    {
        _Color ("Color", Color) = (0.94, 0.96, 0.98, 0.78)
        _Radius ("Corner radius", Range(0.01, 0.2)) = 0.08
    }
    SubShader
    {
        Tags { "Queue"="Transparent" "RenderType"="Transparent" "IgnoreProjector"="True" }
        Blend SrcAlpha OneMinusSrcAlpha
        ZWrite Off
        Cull Off
        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"

            fixed4 _Color;
            float _Radius;

            struct appdata { float4 vertex : POSITION; float2 uv : TEXCOORD0; };
            struct v2f { float4 vertex : SV_POSITION; float2 uv : TEXCOORD0; };

            v2f vert(appdata v)
            {
                v2f o;
                o.vertex = UnityObjectToClipPos(v.vertex);
                o.uv = v.uv;
                return o;
            }

            fixed4 frag(v2f i) : SV_Target
            {
                float2 q = abs(i.uv - 0.5) - (0.5 - _Radius);
                float distance = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - _Radius;
                clip(-distance);
                return _Color;
            }
            ENDCG
        }
    }
}
