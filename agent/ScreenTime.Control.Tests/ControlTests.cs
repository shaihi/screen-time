using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ScreenTime.Control;
using Xunit;

public sealed class ControlTests
{
    [Fact]
    public void SignedOutMidnightStartsNewDayBeforeALaterTimezoneEdit()
    {
        var ledger = new UsageLedger();
        ledger.BindTimeZone("UTC", "2026-10-15");
        ledger.Add("2026-10-15", 600);
        ledger.BindTimeZone("UTC", "2026-10-16");
        ledger.BindTimeZone("Asia/Tokyo", "2026-10-17");
        Assert.Equal(0, ledger.Used("2026-10-17"));
        Assert.Equal(600, ledger.Days["2026-10-15"]);
    }
    [Fact]
    public void MissingSignedRuleFieldsCannotSilentlyDefaultToMonitoring()
    {
        using var rsa = RSA.Create(2048);
        var json = JsonSerializer.Serialize(new SignedPayload(Policy(), Noon), ControlJson.Options).Replace("\"mode\":\"managed\",", "");
        var bytes = Encoding.UTF8.GetBytes(json);
        var envelope = new SignedEnvelope(Convert.ToBase64String(bytes), Convert.ToBase64String(rsa.SignData(bytes, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1)));
        Assert.Throws<InvalidDataException>(() => PolicyVerifier.Verify(envelope, rsa.ExportSubjectPublicKeyInfoPem(), "home", "pc", Policy().WindowsSid));
        Assert.Throws<InvalidDataException>(() => PolicyVerifier.Verify(new(null!, null!), rsa.ExportSubjectPublicKeyInfoPem(), "home", "pc", Policy().WindowsSid));
    }
    [Fact]
    public void FutureManagedRulesWarnWithoutChangingCurrentAllowance()
    {
        var current = PolicyEvaluator.Evaluate(Policy() with { DailyLimitSeconds = 3600 }, Noon, 700);
        var future = Policy() with { Revision = 2, EffectiveAtUtc = Noon.AddMinutes(5) };
        var warned = PolicyEvaluator.WarnPending(current, future, Noon);
        Assert.Equal(300, warned.WarningSeconds);
        Assert.Equal(current.RemainingSeconds, warned.RemainingSeconds);
        Assert.False(warned.Blocked);
        Assert.Equal(60, PolicyEvaluator.WarnPending(current, future, Noon.AddMinutes(4)).WarningSeconds);
    }
    [Fact]
    public void PendingRulesNeverUndoCurrentBlockOrEarlierWarning()
    {
        var future = Policy() with { Revision = 2, EffectiveAtUtc = Noon.AddMinutes(5) };
        var blocked = PolicyEvaluator.Evaluate(Policy(), Noon, 600);
        Assert.Equal(blocked, PolicyEvaluator.WarnPending(blocked, future, Noon));
        var warning = PolicyEvaluator.Evaluate(Policy(), Noon, 541);
        Assert.Equal(warning, PolicyEvaluator.WarnPending(warning, future, Noon));
        Assert.Equal(warning, PolicyEvaluator.WarnPending(warning, future with { Mode = "monitor" }, Noon));
        Assert.Equal(warning, PolicyEvaluator.WarnPending(warning, null, Noon));
        Assert.Equal(warning, PolicyEvaluator.WarnPending(warning, future with { EffectiveAtUtc = Noon }, Noon));
        Assert.Equal(warning, PolicyEvaluator.WarnPending(warning, future with { EffectiveAtUtc = Noon.AddMinutes(6) }, Noon));
    }
    private static readonly DateTimeOffset Noon = DateTimeOffset.Parse("2026-10-15T12:00:00Z");
    private static ControlPolicy Policy() => new() { HouseholdId = "home", DeviceId = "pc", WindowsSid = "S-1-5-21-1-2-3-1001", Revision = 1, IssuedAtUtc = Noon, EffectiveAtUtc = Noon, TimeZone = "UTC", Mode = "managed", DailyLimitSeconds = 600 };
    [Fact]
    public void AtBudgetBoundaryAllAppsAreBlocked()
    {
        Assert.True(PolicyEvaluator.Evaluate(Policy(), Noon, 600).Blocked);
    }
    [Fact]
    public void MonitorNeverBlocks()
    {
        var p = Policy() with
        {
            Mode = "monitor"
        };
        Assert.Equal("monitoring", PolicyEvaluator.Evaluate(p, Noon, 9999).State);
    }
    [Fact]
    public void ParentShutdownOverridesMonitoringAndTemporaryAccess()
    {
        var p = Policy() with
        {
            Mode = "monitor",
            Shutdown = true,
            Override = new(Guid.NewGuid(), Noon.AddHours(1), true, true)
        };
        var decision = PolicyEvaluator.Evaluate(p, Noon, 0);
        Assert.True(decision.Blocked);
        Assert.Equal("Parent requested shutdown", decision.Reason);
    }
    [Fact]
    public void NewBlockCountsDownThenEnforcesAndCancellationClearsIt()
    {
        var blocked = new Decision("blocked", "Parent requested shutdown", 0, null, true);
        var started = RestrictionCountdown.Evaluate(blocked, false, null, Noon);
        Assert.Equal("countdown", started.Decision.State);
        Assert.Equal(30, started.Decision.WarningSeconds);
        Assert.False(started.EnforceBlocked);
        Assert.Equal(Noon.AddSeconds(30), started.CountdownUntilUtc);

        var ticking = RestrictionCountdown.Evaluate(blocked, true, started.CountdownUntilUtc, Noon.AddSeconds(20));
        Assert.Equal(10, ticking.Decision.WarningSeconds);
        Assert.False(ticking.EnforceBlocked);

        var enforced = RestrictionCountdown.Evaluate(blocked, true, started.CountdownUntilUtc, Noon.AddSeconds(30));
        Assert.True(enforced.EnforceBlocked);
        Assert.Null(enforced.CountdownUntilUtc);

        var allowed = new Decision("allowed", "Parent restored access", null, null, false);
        var cancelled = RestrictionCountdown.Evaluate(allowed, true, started.CountdownUntilUtc, Noon.AddSeconds(10));
        Assert.False(cancelled.EnforceBlocked);
        Assert.Null(cancelled.CountdownUntilUtc);
        Assert.Equal("allowed", cancelled.Decision.State);
    }
    [Fact]
    public void GrantsDoNotBypassBedtime()
    {
        var p = Policy() with
        {
            AllowedWindows = [new(4, 0, 60)],
            Grants = [new(Guid.NewGuid(), "2026-10-15", 3600, Noon.AddHours(1))]
        };
        Assert.Equal("Outside allowed hours", PolicyEvaluator.Evaluate(p, Noon, 0).Reason);
    }
    [Fact]
    public void ExpiredOrOtherDayGrantsCannotRenewBudget()
    {
        var p = Policy() with
        {
            Grants = [new(Guid.NewGuid(), "2026-10-15", 60, Noon), new(Guid.NewGuid(), "2026-10-14", 60, Noon.AddHours(1))]
        };
        Assert.True(PolicyEvaluator.Evaluate(p, Noon, 600).Blocked);
    }
    [Fact]
    public void DuplicateGrantIdsApplyOnce()
    {
        var g = new TimeGrant(Guid.NewGuid(), "2026-10-15", 60, Noon.AddHours(1));
        var p = Policy() with
        {
            Grants = [g, g]
        };
        Assert.True(PolicyEvaluator.Evaluate(p, Noon, 660).Blocked);
    }
    [Fact]
    public void OverrideNeedsBothExplicitPermissionsToBypassBothRules()
    {
        var p = Policy() with
        {
            AllowedWindows = [new(4, 0, 60)],
            Override = new(Guid.NewGuid(), Noon.AddHours(1), true, false)
        };
        Assert.True(PolicyEvaluator.Evaluate(p, Noon, 9000).Blocked);
        Assert.False(PolicyEvaluator.Evaluate(p with
        {
            Override = p.Override with
            {
                IgnoreSchedule = true
            }
        }, Noon, 9000).Blocked);
    }
    [Theory]
    [InlineData(300, 300)]
    [InlineData(541, 60)]
    public void WarnsAtFiveAndOneMinuteBoundaries(int used, int warning)
    {
        Assert.Equal(warning, PolicyEvaluator.Evaluate(Policy(), Noon, used).WarningSeconds);
    }
    [Fact]
    public void ScheduleEndAlsoWarns()
    {
        var p = Policy() with
        {
            DailyLimitSeconds = null,
            AllowedWindows = [new(4, 0, 12 * 60 + 1)]
        };
        Assert.Equal(60, PolicyEvaluator.Evaluate(p, Noon, 0).WarningSeconds);
    }
    [Fact]
    public void WindowsTimeZoneUsesPolicyAndMidnight()
    {
        var p = Policy() with
        {
            TimeZone = "Asia/Jerusalem"
        };
        Assert.Equal("2026-10-16", PolicyEvaluator.Day(p, DateTimeOffset.Parse("2026-10-15T22:00:00Z")));
    }
    [Fact]
    public void UsageLedgerNeverResetsWhenDateRegresses()
    {
        var l = new UsageLedger();
        l.Add("2026-10-15", 15);
        l.Add("2026-10-14", 20);
        Assert.Equal(35, l.Used("2026-10-14"));
        l.Add("2026-10-16", 1);
        Assert.Equal(1, l.Used("2026-10-16"));
        Assert.Equal(35, l.Days["2026-10-15"]);
    }
    [Fact]
    public void MissingSensorCountsOnlyVerifiedUnlockedTime()
    {
        Assert.True(UsageAccounting.Count("actual_use", true, false, null));
        Assert.False(UsageAccounting.Count("actual_use", false, false, "active"));
        Assert.False(UsageAccounting.Count("actual_use", true, true, "idle"));
        Assert.True(UsageAccounting.Count("unlocked_session", true, true, "idle"));
        Assert.True(UsageAccounting.Count("actual_use", true, true, "media"));
    }
    [Fact]
    public void FuturePolicyCannotCreateAnEarlyAllowance()
    {
        var current = Policy();
        var next = current with
        {
            Revision = 2,
            DailyLimitSeconds = 3600,
            EffectiveAtUtc = Noon.AddMinutes(5)
        };
        var cache = new PolicyCache();
        cache.Accept(current, "a", Noon);
        cache.Accept(next, "b", Noon);
        Assert.Equal(1, cache.Effective(Noon)!.Revision);
        Assert.True(PolicyEvaluator.Evaluate(cache.Effective(Noon)!, Noon, 700).Blocked);
        Assert.Equal(2, cache.Effective(Noon.AddMinutes(5))!.Revision);
    }
    [Fact]
    public void CacheRejectsRollbackChangedRevisionAndRegressingServerClock()
    {
        var c = new PolicyCache();
        c.Accept(Policy(), "a", Noon);
        Assert.Throws<InvalidDataException>(() => c.Accept(Policy(), "b", Noon));
        Assert.Throws<InvalidDataException>(() => c.Accept(Policy() with { Revision = 0 }, "a", Noon));
        Assert.Throws<InvalidDataException>(() => c.Accept(Policy(), "a", Noon.AddSeconds(-1)));
    }
    [Fact]
    public void SignedPolicyAuthenticatesBytesTargetAndRevision()
    {
        using var rsa = RSA.Create(2048);
        var p = Policy();
        var bytes = JsonSerializer.SerializeToUtf8Bytes(new SignedPayload(p, Noon), ControlJson.Options);
        var envelope = new SignedEnvelope(Convert.ToBase64String(bytes), Convert.ToBase64String(rsa.SignData(bytes, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1)));
        Assert.Equal(JsonSerializer.Serialize(p), JsonSerializer.Serialize(PolicyVerifier.Verify(envelope, rsa.ExportSubjectPublicKeyInfoPem(), "home", "pc", p.WindowsSid).Policy));
        Assert.Throws<InvalidDataException>(() => PolicyVerifier.Verify(envelope, rsa.ExportSubjectPublicKeyInfoPem(), "other", "pc", p.WindowsSid));
        Assert.Throws<InvalidDataException>(() => PolicyVerifier.Verify(envelope with { Payload = Convert.ToBase64String(Encoding.UTF8.GetBytes("{}")) }, rsa.ExportSubjectPublicKeyInfoPem(), "home", "pc", p.WindowsSid));
    }
    [Fact]
    public void RejectInvalidPolicyBeforePrivilegedOperations()
    {
        Assert.Throws<InvalidDataException>(() => PolicyValidation.Validate(Policy() with { WindowsSid = "S-1-5-18" }));
        Assert.Throws<InvalidDataException>(() => PolicyValidation.Validate(Policy() with { AllowedWindows = [new(4, 200, 100)] }));
        Assert.Throws<InvalidDataException>(() => PolicyValidation.Validate(Policy() with { Mode = "remote_shell" }));
    }
    [Fact]
    public void HmacBindsExactBodyPathAndTarget()
    {
        var key = Convert.ToBase64String(new byte[32]);
        var a = RequestAuthentication.Sign(key, "pc", 123, "nonce", "{}");
        Assert.Equal(64, a.Length);
        Assert.NotEqual(a, RequestAuthentication.Sign(key, "pc2", 123, "nonce", "{}"));
        Assert.NotEqual(a, RequestAuthentication.Sign(key, "pc", 123, "nonce", "{ }"));
    }
    [Fact]
    public void TimezoneEditCannotMintAnotherBudget()
    {
        var l = new UsageLedger();
        l.BindTimeZone("UTC", "2026-10-15");
        l.Add("2026-10-15", 600);
        l.BindTimeZone("Asia/Tokyo", "2026-10-16");
        Assert.Equal(600, l.Used("2026-10-16"));
        l.BindTimeZone("UTC", "2026-10-15");
        Assert.Equal(600, l.Used("2026-10-15"));
        Assert.Equal(0, l.Used("2026-10-17"));
    }
    [Fact]
    public void LedgerRejectsUntrustedDurations()
    {
        var l = new UsageLedger();
        Assert.Throws<ArgumentOutOfRangeException>(() => l.Add("2026-10-15", -1));
        Assert.Throws<ArgumentOutOfRangeException>(() => l.Add("2026-10-15", double.NaN));
        Assert.Throws<ArgumentOutOfRangeException>(() => l.Add("2026-10-15", double.PositiveInfinity));
    }
    [Fact]
    public void CacheAllowsIdenticalRetryAndReplacesFutureRevision()
    {
        var c = new PolicyCache();
        c.Accept(Policy(), "a", Noon);
        c.Accept(Policy(), "a", Noon.AddSeconds(1));
        Assert.Equal(1, c.Effective(Noon)!.Revision);
        c.Accept(Policy() with
        {
            Revision = 2,
            EffectiveAtUtc = Noon.AddHours(1)
        }, "b", Noon.AddSeconds(2));
        c.Accept(Policy() with
        {
            Revision = 3,
            EffectiveAtUtc = Noon.AddHours(2)
        }, "c", Noon.AddSeconds(3));
        Assert.Equal(1, c.Effective(Noon.AddHours(1))!.Revision);
        Assert.Equal(3, c.Effective(Noon.AddHours(2))!.Revision);
    }
    [Fact]
    public void UnlimitedBudgetAndAdjacentWindowsRemainAllowed()
    {
        var p = Policy() with
        {
            DailyLimitSeconds = null,
            AllowedWindows = [new(4, 0, 721), new(4, 721, 800)]
        };
        var d = PolicyEvaluator.Evaluate(p, Noon, 99999);
        Assert.False(d.Blocked);
        Assert.Null(d.RemainingSeconds);
        Assert.Null(d.WarningSeconds);
    }
    [Fact]
    public void ExpiredOverrideCannotBypassBudget()
    {
        var p = Policy() with
        {
            Override = new(Guid.NewGuid(), Noon, true, true)
        };
        Assert.True(PolicyEvaluator.Evaluate(p, Noon, 9000).Blocked);
    }
    [Fact]
    public void BudgetOnlyOverrideKeepsAllowedScheduleAndUnlimitedRemaining()
    {
        var p = Policy() with
        {
            AllowedWindows = [new(4, 0, 1440)],
            Override = new(Guid.NewGuid(), Noon.AddHours(1), true, false)
        };
        Assert.Null(PolicyEvaluator.Evaluate(p, Noon, 9000).RemainingSeconds);
    }
    [Fact]
    public void UnknownOrMalformedSignatureIsRejected()
    {
        using var rsa = RSA.Create(2048);
        Assert.Throws<InvalidDataException>(() => PolicyVerifier.Verify(new("!", "!"), rsa.ExportSubjectPublicKeyInfoPem(), "home", "pc", Policy().WindowsSid));
        Assert.Throws<InvalidDataException>(() => PolicyVerifier.Verify(new(new string('a', 262145), "!"), rsa.ExportSubjectPublicKeyInfoPem(), "home", "pc", Policy().WindowsSid));
    }
    public static IEnumerable<object[]> InvalidPolicies()
    {
        yield return [Policy() with { SchemaVersion = 2 }];
        yield return [Policy() with { Revision = 0 }];
        yield return [Policy() with { DeviceId = "bad/id" }];
        yield return [Policy() with { HouseholdId = "" }];
        yield return [Policy() with { BudgetBasis = "duration" }];
        yield return [Policy() with { DailyLimitSeconds = 1 }];
        yield return [Policy() with { DailyLimitSeconds = 86401 }];
        yield return [Policy() with { EffectiveAtUtc = Noon.AddSeconds(-1) }];
        yield return [Policy() with { IssuedAtUtc = default }];
        yield return [Policy() with { TimeZone = "Not/AZone" }];
        yield return [Policy() with { AllowedWindows = null! }];
        yield return [Policy() with { Grants = null! }];
        yield return [Policy() with { AllowedWindows = Enumerable.Repeat(new AllowedWindow(4, 0, 1), 129).ToArray() }];
        yield return [Policy() with { AllowedWindows = [new(-1, 0, 1)] }];
        yield return [Policy() with { AllowedWindows = [new(4, -1, 1)] }];
        yield return [Policy() with { AllowedWindows = [new(4, 0, 1441)] }];
        yield return [Policy() with { Grants = [new(Guid.Empty, "2026-10-15", 60, Noon)] }];
        yield return [Policy() with { Grants = [new(Guid.NewGuid(), "invalid", 60, Noon)] }];
        yield return [Policy() with { Grants = [new(Guid.NewGuid(), "2026-10-15", 1, Noon)] }];
        yield return [Policy() with { Override = new(Guid.Empty, Noon.AddHours(1), true, false) }];
        yield return [Policy() with { Override = new(Guid.NewGuid(), Noon.AddHours(25), true, false) }];
        yield return [Policy() with { Override = new(Guid.NewGuid(), Noon.AddHours(1), false, false) }];
    }
    [Theory][MemberData(nameof(InvalidPolicies))] public void MalformedRulesCannotReachEnforcement(ControlPolicy p) => Assert.Throws<InvalidDataException>(() => PolicyValidation.Validate(p));
}
