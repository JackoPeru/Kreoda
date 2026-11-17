using System.Reflection;
using NUnit.Framework;

namespace Kreoda.QuestRuntime.Tests
{
    public class QuestEnvironmentTests
    {
        [Test]
        public void StartupMigratesPreviouslySavedVrPreferenceToPassthrough()
        {
            var migration = typeof(QuestEnvironment).GetMethod("ResolveStartupPreference", BindingFlags.Public | BindingFlags.Static);
            Assert.That(migration, Is.Not.Null, "startup preference migration must be explicit and testable");
            Assert.That(migration.Invoke(null, new object[] { 0 }), Is.EqualTo(true), "saved VR preference must not hide passthrough after upgrade");
            Assert.That(migration.Invoke(null, new object[] { 1 }), Is.EqualTo(true));
        }

        [Test]
        public void FailedPassthroughStatusNeverClaimsThatRoomIsVisible()
        {
            var status = typeof(QuestEnvironment).GetMethod("StatusText", BindingFlags.Public | BindingFlags.Static);
            Assert.That(status, Is.Not.Null, "passthrough status must distinguish initialization failure from visible MR");
            var message = (string)status.Invoke(null, new object[] { true, false, true, false });
            Assert.That(message, Does.Contain("VR").And.Contain("MR non disponibile"));
            Assert.That(message, Does.Not.Contain("MR attivo"));
        }
    }
}
