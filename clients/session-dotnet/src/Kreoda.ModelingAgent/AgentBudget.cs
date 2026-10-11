namespace Kreoda.ModelingAgent;

public sealed record AgentLimits
{
    public int MaxActions { get; }
    public int MaxFeatures { get; }
    public int MaxIterations { get; }
    public int MaxCorrections { get; }
    public TimeSpan MaxDuration { get; }

    public AgentLimits(int maxActions = 64, int maxFeatures = 32, int maxIterations = 16,
        int maxCorrections = 3, TimeSpan? maxDuration = null)
    {
        if (maxActions is < 1 or > 256 || maxFeatures is < 1 or > 128 ||
            maxIterations is < 1 or > 64 || maxCorrections is < 0 or > 16)
            throw new ArgumentOutOfRangeException(nameof(maxActions), "Agent limits must be finite and bounded");
        var duration = maxDuration ?? TimeSpan.FromSeconds(180);
        if (duration <= TimeSpan.Zero || duration > TimeSpan.FromMinutes(10))
            throw new ArgumentOutOfRangeException(nameof(maxDuration));
        MaxActions = maxActions;MaxFeatures = maxFeatures;MaxIterations = maxIterations;
        MaxCorrections = maxCorrections;MaxDuration = duration;
    }
}

public sealed class AgentBudgetExceededException(string limit) : Exception("Agent budget exhausted: " + limit)
{
    public string Limit { get; } = limit;
}

/// <summary>One serialized agent loop owns these counters. Reads count as actions too.</summary>
public sealed class AgentBudget
{
    readonly AgentLimits _limits;
    readonly TimeProvider _clock;
    readonly long _started;
    public int Actions { get; private set; }
    public int CreatedFeatures { get; private set; }
    public int Iterations { get; private set; }
    public int Corrections { get; private set; }
    public TimeSpan Remaining => _limits.MaxDuration - _clock.GetElapsedTime(_started);

    public AgentBudget(AgentLimits limits, TimeProvider? clock = null)
    {
        _limits = limits;_clock = clock ?? TimeProvider.System;
        _started = _clock.GetTimestamp();
    }
    public void RequireTime()
    {
        if (Remaining <= TimeSpan.Zero) throw new AgentBudgetExceededException("time");
    }
    public void Action(bool createsFeature = false) => Action(createsFeature ? 1 : 0);

    public void Action(int createdFeatureCount)
    {
        if (createdFeatureCount < 0) throw new ArgumentOutOfRangeException(nameof(createdFeatureCount));
        RequireTime();
        if (Actions >= _limits.MaxActions) throw new AgentBudgetExceededException("actions");
        if (createdFeatureCount > _limits.MaxFeatures - CreatedFeatures) throw new AgentBudgetExceededException("features");
        Actions++;
        CreatedFeatures += createdFeatureCount;
    }
    public void Iteration()
    {
        RequireTime();
        if (Iterations >= _limits.MaxIterations) throw new AgentBudgetExceededException("iterations");
        Iterations++;
    }
    public void Correction()
    {
        RequireTime();
        if (Corrections >= _limits.MaxCorrections) throw new AgentBudgetExceededException("corrections");
        Corrections++;
    }
}
