using System;
using UnityEngine;

namespace Kreoda.QuestRuntime
{
    public static class QuestUi
    {
        public static readonly Color Ink = new Color(.08f, .11f, .16f);
        public static readonly Color Accent = new Color(.08f, .36f, .78f);

        public static TextMesh Label(Transform parent, Font font, string text, Vector3 position, float size,
            Vector2 bounds, Action<TextMesh, Vector2> register, Color? color = null)
        {
            var label = new GameObject(text).AddComponent<TextMesh>();
            label.transform.SetParent(parent, false);
            label.transform.localPosition = position;
            label.font = font;
            label.fontSize = 64;
            label.characterSize = size * 10f / label.fontSize;
            label.anchor = TextAnchor.UpperLeft;
            label.text = text;
            label.color = color ?? Ink;
            label.GetComponent<MeshRenderer>().sharedMaterial = font.material;
            register?.Invoke(label, bounds);
            return label;
        }

        public static TextMesh Button(Transform parent, Font font, Material material, string id, string text,
            Vector3 position, float width, float height, float textSize, Action click,
            Action<TextMesh, Vector2> register, Color? color = null)
        {
            var group = new GameObject(text + " control").transform;
            group.SetParent(parent, false);
            var button = GameObject.CreatePrimitive(PrimitiveType.Cube);
            button.name = text;
            button.transform.SetParent(group, false);
            button.transform.localPosition = position;
            button.transform.localScale = new Vector3(width, height, .008f);
            button.GetComponent<MeshRenderer>().sharedMaterial = material;
            var input = button.AddComponent<QuestButton>();
            input.ActionId = id;
            input.Click = click;
            return Label(group, font, text, position + new Vector3(-width / 2 + .008f, height / 2 - .006f, -.006f),
                textSize, new Vector2(width - .016f, height - .010f), register, color);
        }

        public static GameObject Surface(Transform parent, Material material, string name, Vector3 position, Vector3 size)
        {
            var surface = GameObject.CreatePrimitive(PrimitiveType.Cube);
            surface.name = name;
            surface.transform.SetParent(parent, false);
            surface.transform.localPosition = position;
            surface.transform.localScale = size;
            surface.GetComponent<MeshRenderer>().sharedMaterial = material;
            surface.GetComponent<Collider>().enabled = false;
            return surface;
        }
    }
}
