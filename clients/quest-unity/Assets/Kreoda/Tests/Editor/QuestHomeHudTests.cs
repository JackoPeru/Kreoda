using NUnit.Framework;

namespace Kreoda.QuestRuntime.Tests
{
    public sealed class QuestHomeHudTests
    {
        [Test]
        public void HomeOnlyExposesRoutedActionsNotPlaceholderTemplates()
        {
            foreach (var action in new[] { "home:pc", "home:view", "home:ai", "home:project:select",
                "home:project:open", "home:project:new", "home:project:import", "home:project:template",
                "home:design", "home:model", "home:measure", "home:render" })
                Assert.That(QuestHome.IsWiredHomeAction(action), Is.True, action);
            Assert.That(QuestHome.IsWiredHomeAction("home:fake:task"), Is.False);
        }
    }
}
