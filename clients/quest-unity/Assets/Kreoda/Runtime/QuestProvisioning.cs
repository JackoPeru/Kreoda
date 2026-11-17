using System;

namespace Kreoda.QuestRuntime
{
    internal static class QuestProvisioning
    {
        // Android checks DUMP on this alias before delivering the launch intent.
        internal const string Component = "com.kreoda.quest.AdbProvisioning";
        internal static bool Trusted(string component) => string.Equals(component, Component, StringComparison.Ordinal);
    }
}
