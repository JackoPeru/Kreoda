using System;
using UnityEngine;

namespace Kreoda.QuestRuntime
{
    public sealed class QuestHome : MonoBehaviour
    {
        public Transform Page { get; private set; }
        public TextMesh ConnectionStatus { get; private set; }
        public GameObject Background { get; private set; }

        public Transform Build(Transform parent, Font font, Material panelMaterial, Material buttonMaterial,
            Action<TextMesh, Vector2> register, Action<string> activate)
        {
            if (Page != null) return Page;
            Page = new GameObject("Home").transform;
            Page.SetParent(parent, false);
            Background = QuestUi.Surface(Page, panelMaterial, "Home background",
                new Vector3(0, -.005f, .008f), new Vector3(.66f, .55f, .008f));
            QuestUi.Label(Page, font, "KREODA", new Vector3(-.28f, .18f, -.003f), .022f,
                new Vector2(.20f, .042f), register);
            QuestUi.Label(Page, font, "Progetta · Visualizza · Realizza", new Vector3(-.28f, .098f, -.003f), .011f,
                new Vector2(.36f, .023f), register);
            QuestUi.Label(Page, font, "Dalla tua idea al mondo reale", new Vector3(-.28f, .067f, -.003f), .009f,
                new Vector2(.32f, .02f), register, new Color(.24f, .29f, .36f));
            ConnectionStatus = QuestUi.Button(Page, font, buttonMaterial, "home:pc", "PC non connesso",
                new Vector3(.215f, .098f, 0), .19f, .030f, .0095f, () => activate?.Invoke("home:pc"), register, QuestUi.Accent);
            ConnectionStatus.transform.parent.name = "PC status control";

            QuestUi.Label(Page, font, "Progetti recenti", new Vector3(-.28f, .028f, -.003f), .013f,
                new Vector2(.25f, .024f), register);
            QuestUi.Label(Page, font, "Ancora nessun progetto\nsincronizzato", new Vector3(-.28f, -.008f, -.003f), .010f,
                new Vector2(.25f, .052f), register, new Color(.27f, .32f, .39f));
            QuestUi.Label(Page, font, "Task in corso", new Vector3(-.28f, -.092f, -.003f), .013f,
                new Vector2(.25f, .024f), register);
            QuestUi.Label(Page, font, "Nessun task attivo", new Vector3(-.28f, -.124f, -.003f), .010f,
                new Vector2(.25f, .023f), register, new Color(.27f, .32f, .39f));

            QuestUi.Label(Page, font, "Inizia da qui", new Vector3(-.015f, .028f, -.003f), .013f,
                new Vector2(.33f, .024f), register);
            Quick("home:project:new", "Nuovo Progetto", .055f, -.010f, font, buttonMaterial, register, activate, .009f);
            Quick("home:project:import", "Importa", .235f, -.010f, font, buttonMaterial, register, activate, .0095f);
            Quick("home:project:template", "Template", .055f, -.073f, font, buttonMaterial, register, activate, .0095f);
            Quick("home:ai", "AI Assistant", .235f, -.073f, font, buttonMaterial, register, activate, .0095f, QuestUi.Accent);

            Quick("home:design", "Disegna", -.27f, -.166f, font, buttonMaterial, register, activate, .0085f, QuestUi.Accent, .11f);
            Quick("home:model", "Modella", -.135f, -.166f, font, buttonMaterial, register, activate, .0085f, QuestUi.Accent, .11f);
            Quick("home:view", "Visualizza", 0, -.166f, font, buttonMaterial, register, activate, .0082f, QuestUi.Accent, .11f);
            Quick("home:measure", "Misura", .135f, -.166f, font, buttonMaterial, register, activate, .0085f, QuestUi.Accent, .11f);
            Quick("home:render", "Render", .27f, -.166f, font, buttonMaterial, register, activate, .0085f, QuestUi.Accent, .11f);
            QuestUi.Label(Page, font, "Ogni spazio racconta una storia.", new Vector3(-.28f, -.215f, -.003f), .009f,
                new Vector2(.60f, .018f), register, new Color(.24f, .29f, .36f));
            return Page;
        }

        public void SetConnectionStatus(string status)
        {
            if (ConnectionStatus == null) return;
            if (string.IsNullOrWhiteSpace(status)) status = "PC non connesso";
            ConnectionStatus.text = status.Length > 32 ? status.Substring(0, 31) + "…" : status;
        }

        void Quick(string id, string text, float x, float y, Font font, Material material,
            Action<TextMesh, Vector2> register, Action<string> activate, float textSize, Color? color = null, float width = .17f)
        {
            QuestUi.Button(Page, font, material, id, text, new Vector3(x, y, 0), width, .047f,
                textSize, () => activate?.Invoke(id), register, color);
        }
    }
}
