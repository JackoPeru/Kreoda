using System;
using System.Text.Json;
using NUnit.Framework;

namespace Kreoda.QuestRuntime.Tests
{
    public class QuestThicknessInspectionTests
    {
        const string Result = "{\"result\":{\"basis\":\"occt-sampled-normal-rays\",\"isGlobalMinimum\":false,\"featureId\":\"box\",\"requestedSamples\":128,\"solidCount\":1,\"totalFaces\":6,\"sampledFaces\":6,\"attemptedSamples\":128,\"validSamples\":128,\"missedSamples\":0,\"timeBudgetExceeded\":false,\"minimumThicknessMm\":2.5,\"witness\":{\"pointAMm\":[1,2,3],\"pointBMm\":[1,2,5.5]}}}";
        [Test]
        public void DisplaysSampledThicknessAndCoverageWithoutClaimingGlobalCertification()
        {
            using var response=JsonDocument.Parse(Result);
            var text=QuestThicknessInspection.Format(response.RootElement,"box");
            Assert.That(text,Does.Contain("2.5 mm").And.Contain("128").And.Contain("6/6 facce"));
            Assert.That(text,Does.Contain("Campionato").And.Contain("non garantito"));
        }
        [TestCase("\"isGlobalMinimum\":false","\"isGlobalMinimum\":true")]
        [TestCase("\"validSamples\":128","\"validSamples\":129")]
        [TestCase("\"minimumThicknessMm\":2.5","\"minimumThicknessMm\":0")]
        [TestCase("[1,2,5.5]","[1,2,100]")]
        [TestCase("\"featureId\":\"box\"","\"featureId\":\"other\"")]
        public void RejectsInvalidUnrelatedOrMisleadingNativeResults(string from,string to)
        {
            using var response=JsonDocument.Parse(Result.Replace(from,to));
            Assert.Throws<FormatException>(()=>QuestThicknessInspection.Format(response.RootElement,"box"));
        }
        [Test]
        public void UnknownMeasurementDoesNotBecomeZero()
        {
            var text=Result.Replace("\"sampledFaces\":6","\"sampledFaces\":0").Replace("\"validSamples\":128","\"validSamples\":0")
                .Replace("\"missedSamples\":0","\"missedSamples\":128").Replace("\"minimumThicknessMm\":2.5","\"minimumThicknessMm\":null")
                .Replace("{\"pointAMm\":[1,2,3],\"pointBMm\":[1,2,5.5]}","null");
            using var response=JsonDocument.Parse(text);
            var formatted=QuestThicknessInspection.Format(response.RootElement,"box");
            Assert.That(formatted,Does.Contain("Nessuna misura").And.Contain("copertura incompleta"));
            Assert.That(formatted,Does.Not.Contain("0 mm"));
        }
    }
}
