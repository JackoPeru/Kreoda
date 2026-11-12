using System.Text.Json;
using Kreoda.ModelingAgent;
using Xunit;

namespace Kreoda.HermesBridge.Tests;

public sealed class VoiceCandidateApprovalTests
{
    [Fact]
    public async Task TypedOptionsAreLineageFencedAndNeverAutoExecuted()
    {
        var approval = new VoiceCandidateApproval();
        using var parameters = JsonDocument.Parse("{\"widthMm\":10}");
        using var query = JsonDocument.Parse("{}");
        var option = new GeneratedCadOption("candidate-1", "Editable CAD proposal", new[] {
            new GeneratedCadStep("CreateBox", parameters.RootElement.Clone(), "bounded") });
        var check = new CadCheck("measureVolume", query.RootElement.Clone(), "volumeMm3", 10);
        var proposal = approval.Register("session-a", "document-a", 7, new[] { option }, new[] { check });
        Assert.Equal(1, proposal.Version);
        Assert.Single(proposal.Choices);
        Assert.Equal("candidate-1", proposal.Choices[0].Id);
        await Assert.ThrowsAsync<ArgumentException>(() => approval.ApproveAsync(proposal.ProposalId,
            "candidate-1", "session-a", "document-a", 8, null!));
        await Assert.ThrowsAsync<ArgumentException>(() => approval.ApproveAsync(proposal.ProposalId,
            "unlisted", "session-a", "document-a", 7, null!));
    }

    [Fact]
    public void CannotRegisterEmptyOrDuplicateChoices()
    {
        var approval = new VoiceCandidateApproval();
        Assert.Throws<ArgumentException>(() => approval.Register("s", "d", 1,
            Array.Empty<GeneratedCadOption>(), Array.Empty<CadCheck>()));
    }
}
