Shader "Kreoda/SectionEdge"
{
    Properties
    {
        _Color ("Color", Color) = (.06, .1, .15, 1)
        _SectionEnabled ("Section Enabled", Float) = 0
        _SectionInverted ("Section Inverted", Float) = 0
        _SectionNormalLocal ("Section Normal (Local)", Vector) = (0, 1, 0, 0)
        _SectionOffsetLocal ("Section Offset (Local m)", Float) = 0
    }
    SubShader
    {
        Tags { "Queue"="Geometry+2" "RenderType"="Transparent" }
        Blend SrcAlpha OneMinusSrcAlpha
        ZWrite Off
        Offset -2, -2
        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_instancing
            #include "UnityCG.cginc"
            fixed4 _Color;
            float _SectionEnabled, _SectionInverted, _SectionOffsetLocal;
            float4 _SectionNormalLocal;
            struct appdata { float4 vertex : POSITION; UNITY_VERTEX_INPUT_INSTANCE_ID };
            struct v2f
            {
                float4 position : SV_POSITION;
                float3 localPosition : TEXCOORD0;
                UNITY_VERTEX_OUTPUT_STEREO
            };
            v2f vert(appdata input)
            {
                v2f output;
                UNITY_SETUP_INSTANCE_ID(input);
                UNITY_INITIALIZE_OUTPUT(v2f, output);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(output);
                output.position = UnityObjectToClipPos(input.vertex);
                output.localPosition = input.vertex.xyz;
                return output;
            }
            fixed4 frag(v2f input) : SV_Target
            {
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(input);
                float side = dot(_SectionNormalLocal.xyz, input.localPosition) - _SectionOffsetLocal;
                clip(_SectionEnabled > .5 ? (_SectionInverted > .5 ? -side : side) : 1);
                return _Color;
            }
            ENDCG
        }
    }
}
