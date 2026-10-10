Shader "Kreoda/Selection"
{
    Properties { _Color ("Color", Color) = (0, 0.8, 1, 0.45) }
    SubShader
    {
        Tags { "Queue"="Transparent" "RenderType"="Transparent" }
        Blend SrcAlpha OneMinusSrcAlpha
        ZWrite Off
        Offset -1, -1
        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_instancing
            #include "UnityCG.cginc"
            fixed4 _Color;
            struct appdata { float4 vertex : POSITION; UNITY_VERTEX_INPUT_INSTANCE_ID };
            struct v2f { float4 position : SV_POSITION; UNITY_VERTEX_OUTPUT_STEREO };
            v2f vert(appdata input)
            {
                v2f result;
                UNITY_SETUP_INSTANCE_ID(input);
                UNITY_INITIALIZE_OUTPUT(v2f, result);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(result);
                result.position = UnityObjectToClipPos(input.vertex);
                return result;
            }
            fixed4 frag(v2f input) : SV_Target
            {
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(input);
                return _Color;
            }
            ENDCG
        }
    }
}
