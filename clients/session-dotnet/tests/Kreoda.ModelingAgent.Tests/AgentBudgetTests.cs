using Kreoda.ModelingAgent;
using Xunit;

namespace Kreoda.ModelingAgent.Tests;

public sealed class AgentBudgetTests
{
    sealed class Clock : TimeProvider
    {
        public DateTimeOffset Now = DateTimeOffset.UtcNow;
        public long Ticks;
        public override DateTimeOffset GetUtcNow() => Now;
        public override long TimestampFrequency => TimeSpan.TicksPerSecond;
        public override long GetTimestamp() => Ticks;
    }

    [Theory]
    [InlineData(0, 1, 1, 1)]
    [InlineData(1, 0, 1, 1)]
    [InlineData(1, 1, 0, 1)]
    [InlineData(1, 1, 1, -1)]
    [InlineData(1000000, 1, 1, 1)]
    public void InvalidLimitsFailBeforeStarting(int actions, int features, int iterations, int corrections) =>
        Assert.Throws<ArgumentOutOfRangeException>(() => new AgentLimits(actions, features, iterations, corrections));

    [Fact]
    public void EveryActionCountsIncludingQueriesAndRejectionsAreAtomic()
    {
        var budget = new AgentBudget(new AgentLimits(2, 1, 1, 0));
        budget.Action(createsFeature: true);
        Assert.Throws<AgentBudgetExceededException>(() => budget.Action(createsFeature: true));
        Assert.Equal(1, budget.Actions);
        Assert.Equal(1, budget.CreatedFeatures);
        budget.Action();
        Assert.Throws<AgentBudgetExceededException>(() => budget.Action());
        budget.Iteration();
        Assert.Throws<AgentBudgetExceededException>(() => budget.Iteration());
        Assert.Throws<AgentBudgetExceededException>(() => budget.Correction());
    }

    [Fact]
    public void DeadlineAppliesToReadsAndMutations()
    {
        var clock = new Clock();
        var budget = new AgentBudget(new AgentLimits(maxDuration: TimeSpan.FromSeconds(1)), clock);
        clock.Now += TimeSpan.FromSeconds(1);
        clock.Ticks += TimeSpan.TicksPerSecond;
        Assert.Throws<AgentBudgetExceededException>(() => budget.Action());
        Assert.Throws<AgentBudgetExceededException>(() => budget.Iteration());
        Assert.Equal(0, budget.Actions);
    }

    [Fact]
    public void SystemClockRollbackCannotExtendTheHardDeadline()
    {
        var clock = new Clock();
        var budget = new AgentBudget(new AgentLimits(maxDuration: TimeSpan.FromSeconds(1)), clock);
        clock.Now -= TimeSpan.FromHours(1);
        clock.Ticks += 2 * TimeSpan.TicksPerSecond;
        Assert.Throws<AgentBudgetExceededException>(() => budget.Action());
    }
}
