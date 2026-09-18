[CmdletBinding()]
param(
    [ValidateSet('Preflight', 'Discover', 'Analyze')]
    [string]$Mode = 'Discover',

    [ValidateSet('Explicit', 'Scene', 'Directory', 'Synthetic')]
    [string]$Scope = 'Explicit',

    [string[]]$MaterialPath = @(),
    [string]$ScenePath = '',
    [string]$Directory = '',
    [string]$ShaderName = '',
    [string]$SelectionsPath = '',
    [string]$OutputPath = 'malioc-analysis.json',
    [string]$BuildTarget = 'Android',
    [string]$CompilerPlatform = 'GLES3x',
    [string]$MaliCore = 'Mali-G78',
    [int]$SubShader = 0,
    [string]$PassName = 'ForwardLit',
    [switch]$SelfTest
)

$ErrorActionPreference = 'Stop'

function ConvertTo-CSharpString {
    param([AllowNull()][string]$Value)

    if ($null -eq $Value) { return 'null' }
    return '"' + $Value.Replace('\', '\\').Replace('"', '\"').Replace("`r", '\r').Replace("`n", '\n') + '"'
}

function Invoke-UnityCode {
    param([Parameter(Mandatory)][string]$Code)

    $codePath = [IO.Path]::ChangeExtension([IO.Path]::GetTempFileName(), '.csx')
    try {
        [IO.File]::WriteAllText($codePath, $Code, [Text.UTF8Encoding]::new($false))
        $raw = Invoke-UloopCli @('execute-dynamic-code', '--code-file', $codePath)
        $response = ($raw -join [Environment]::NewLine) | ConvertFrom-Json
        if (-not $response.Success) {
            $details = if ($response.DiagnosticsSummary) { $response.DiagnosticsSummary } else { $response.ErrorMessage }
            throw "Unity dynamic code failed: $details"
        }
        return [string]$response.Result
    }
    finally {
        Remove-Item -LiteralPath $codePath -Force -ErrorAction SilentlyContinue
    }
}

function Resolve-UloopCli {
    foreach ($commandName in @('uloop', 'uloop-cli')) {
        $command = Get-Command $commandName -CommandType Application, ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($null -ne $command) {
            return [pscustomobject]@{ kind = 'Command'; path = $command.Path; displayName = $command.Name }
        }
    }

    $npxCommand = Get-Command npx -CommandType Application, ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1
    $npmCommand = Get-Command npm -CommandType Application, ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $npxCommand -or $null -eq $npmCommand) {
        throw 'uloop was not found as a command, and npm/npx are unavailable.'
    }

    $cacheEntries = @(& $npmCommand.Path cache ls uloop-cli@2.2.0 2>&1)
    if ($LASTEXITCODE -ne 0 -or -not ($cacheEntries -match 'uloop-cli-2\.2\.0\.tgz')) {
        throw 'uloop-cli@2.2.0 is not installed or present in the local npm cache.'
    }

    return [pscustomobject]@{ kind = 'NpxCache'; path = $npxCommand.Path; displayName = 'npx --no-install uloop-cli@2.2.0' }
}

function Invoke-UloopCli {
    param([Parameter(Mandatory)][string[]]$Arguments)

    $output = if ($script:UnityCli.kind -eq 'Command') {
        & $script:UnityCli.path @Arguments
    }
    else {
        & $script:UnityCli.path --no-install uloop-cli@2.2.0 @Arguments
    }
    if ($LASTEXITCODE -ne 0) { throw "Unity CLI failed with exit code $LASTEXITCODE." }
    return @($output)
}

function Get-Prerequisites {
    $discoveryFailures = [Collections.Generic.List[string]]::new()

    $maliocCommand = Get-Command malioc -CommandType Application -ErrorAction SilentlyContinue
    if ($null -eq $maliocCommand) {
        $discoveryFailures.Add('MaliOC is unavailable: malioc was not found on PATH.')
    }

    try {
        $script:UnityCli = Resolve-UloopCli
    }
    catch {
        $discoveryFailures.Add("Unity CLI is unavailable: $($_.Exception.Message)")
    }

    if ($discoveryFailures.Count -gt 0) {
        throw "Capability discovery failed. No Unity bridge was invoked and no shader analysis was started.`n- $($discoveryFailures -join "`n- ")"
    }

    $validationFailures = [Collections.Generic.List[string]]::new()
    $maliocVersion = ''
    $unityVersion = ''
    try {
        $versionOutput = @(& $maliocCommand.Path --version 2>&1)
        if ($LASTEXITCODE -ne 0) { throw "malioc --version exited with code $LASTEXITCODE." }
        $maliocVersion = [string]($versionOutput | Select-Object -First 1)
        if ([string]::IsNullOrWhiteSpace($maliocVersion)) { throw 'malioc --version returned no version.' }
    }
    catch {
        $validationFailures.Add("MaliOC is unusable: $($_.Exception.Message)")
    }

    try {
        $unityVersion = Invoke-UnityCode 'return UnityEngine.Application.unityVersion;'
        if ([string]::IsNullOrWhiteSpace($unityVersion)) { throw 'The Unity bridge returned no Unity version.' }
    }
    catch {
        $validationFailures.Add("Unity CLI cannot reach a ready Unity Editor: $($_.Exception.Message)")
    }

    if ($validationFailures.Count -gt 0) {
        throw "Capability validation failed. No shader analysis was started.`n- $($validationFailures -join "`n- ")"
    }

    return [pscustomobject][ordered]@{
        status = 'Ready'
        maliocVersion = $maliocVersion
        unityBridge = $script:UnityCli.displayName
        unityVersion = $unityVersion
    }
}

function ConvertFrom-Base64Text {
    param([string]$Value)
    return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Value))
}

function Write-JsonFile {
    param([Parameter(Mandatory)]$Value)

    $fullPath = [IO.Path]::GetFullPath($OutputPath)
    $parent = [IO.Path]::GetDirectoryName($fullPath)
    if ($parent) { [IO.Directory]::CreateDirectory($parent) | Out-Null }
    $Value | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $fullPath -Encoding utf8
}

function Get-SelectionDocument {
    if (-not $SelectionsPath -or -not (Test-Path -LiteralPath $SelectionsPath)) {
        return [pscustomobject]@{ selections = @(); keywordDependencies = @(); featureBaselines = @(); syntheticCombinations = @() }
    }

    $document = Get-Content -Raw -LiteralPath $SelectionsPath | ConvertFrom-Json
    return [pscustomobject]@{
        selections = @($document.selections)
        keywordDependencies = @($document.keywordDependencies)
        featureBaselines = @($document.featureBaselines)
        syntheticCombinations = @($document.syntheticCombinations | Where-Object { $null -ne $_ })
    }
}

function Get-PragmaGroups {
    param(
        [Parameter(Mandatory)][string]$SourceCode,
        [Parameter(Mandatory)][string]$ShaderGuid,
        [Parameter(Mandatory)][ValidateSet('multi_compile', 'shader_feature')][string]$Family
    )

    $kindPattern = if ($Family -eq 'multi_compile') {
        'multi_compile(?:_local)?(?:_(?:vertex|fragment))?'
    }
    else {
        'shader_feature(?:_local)?(?:_(?:vertex|fragment))?'
    }
    $pattern = "(?im)^\s*#pragma\s+(?<kind>$kindPattern)\s+(?<options>[^/\r\n]+)"
    $groups = @()
    $index = 0
    foreach ($match in [regex]::Matches($SourceCode, $pattern)) {
        $options = @($match.Groups['options'].Value.Trim() -split '\s+' | Where-Object { $_ })
        if ($options.Count -eq 0) { continue }
        $kind = $match.Groups['kind'].Value
        $stage = if ($kind.EndsWith('_vertex')) { 'Vertex' } elseif ($kind.EndsWith('_fragment')) { 'Fragment' } else { 'Both' }
        $groups += [pscustomobject][ordered]@{
            groupId = "$ShaderGuid|$SubShader|$PassName|$Family|$index"
            directive = $kind
            stage = $stage
            options = $options
            displayOptions = @($options | ForEach-Object { if ($_ -eq '_') { 'OFF' } else { $_ } })
            hasOffBaseline = ($options -contains '_') -or ($Family -eq 'shader_feature' -and $options.Count -eq 1)
        }
        $index++
    }
    return @($groups)
}

function Get-KeywordOrder {
    param([Parameter(Mandatory)]$Groups)
    return @($Groups | ForEach-Object { $_.options } | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) -and $_ -ne '_' } | Select-Object -Unique)
}

function Get-KeywordSortKey {
    param([string[]]$Keywords, [string[]]$KeywordOrder)

    return @($Keywords | ForEach-Object {
        $index = [Array]::IndexOf($KeywordOrder, $_)
        if ($index -lt 0) { $index = [int]::MaxValue }
        '{0:D10}:{1}' -f $index, $_
    }) -join [char]31
}

function Get-DefinedKeywords {
    param([string]$Condition)

    $result = @([regex]::Matches($Condition, '(?:defined\s*\(\s*|defined\s+)(?<keyword>[A-Za-z_][A-Za-z0-9_]*)\s*\)?') | ForEach-Object {
        $_.Groups['keyword'].Value
    })
    if ($result.Count -eq 0 -and $Condition -match '^\s*(?<keyword>[A-Za-z_][A-Za-z0-9_]*)\s*$') {
        $result = @($Matches['keyword'])
    }
    return @($result | Select-Object -Unique)
}

function Get-DependencyAnalysis {
    param(
        [Parameter(Mandatory)][string]$SourceCode,
        [Parameter(Mandatory)]$FeatureGroups,
        [Parameter(Mandatory)]$SelectionDocument
    )

    $featureKeywords = @(Get-KeywordOrder $FeatureGroups)
    $featureSet = @{}
    $keywordGroup = @{}
    foreach ($group in @($FeatureGroups)) {
        foreach ($keyword in @($group.options | Where-Object { $_ -ne '_' })) {
            $featureSet[$keyword] = $true
            $keywordGroup[$keyword] = $group.groupId
        }
    }

    $overrideMap = @{}
    foreach ($entry in @($SelectionDocument.keywordDependencies)) {
        if ($entry.keyword) { $overrideMap[[string]$entry.keyword] = @($entry.requires | ForEach-Object { [string]$_ } | Select-Object -Unique) }
    }
    $baselineMap = @{}
    foreach ($entry in @($SelectionDocument.featureBaselines)) {
        if ($entry.groupId) { $baselineMap[[string]$entry.groupId] = [string]$entry.baseline }
    }

    $occurrences = @{}
    $issues = [Collections.ArrayList]::new()
    $guardStack = [Collections.ArrayList]::new()
    foreach ($line in $SourceCode -split "`r?`n") {
        if ($line -match '^\s*#\s*endif\b') {
            if ($guardStack.Count -gt 0) { $guardStack.RemoveAt($guardStack.Count - 1) }
            continue
        }
        if ($line -match '^\s*#\s*else\b') {
            if ($guardStack.Count -gt 0) { $guardStack.RemoveAt($guardStack.Count - 1) }
            [void]$guardStack.Add(@())
            continue
        }

        $condition = $null
        $isElif = $false
        if ($line -match '^\s*#\s*ifdef\s+(?<condition>[A-Za-z_][A-Za-z0-9_]*)') {
            $condition = $Matches['condition']
        }
        elseif ($line -match '^\s*#\s*if\s+(?<condition>.+)$') {
            $condition = $Matches['condition']
        }
        elseif ($line -match '^\s*#\s*elif\s+(?<condition>.+)$') {
            $condition = $Matches['condition']
            $isElif = $true
        }
        if ($null -eq $condition) { continue }
        if ($isElif -and $guardStack.Count -gt 0) { $guardStack.RemoveAt($guardStack.Count - 1) }

        $conditionKeywords = @(Get-DefinedKeywords $condition | Where-Object { $null -ne $_ -and $featureSet.ContainsKey($_) })
        $parents = @($guardStack | ForEach-Object { @($_) } | ForEach-Object { $_ } | Where-Object { $_ } | Select-Object -Unique)
        foreach ($keyword in $conditionKeywords) {
            if (-not $occurrences.ContainsKey($keyword)) { $occurrences[$keyword] = [Collections.ArrayList]::new() }
            [void]$occurrences[$keyword].Add(@($parents))
        }

        $simplePositive = $conditionKeywords.Count -eq 1 -and (
            $condition -match '^\s*(?:defined\s*\(\s*[A-Za-z_][A-Za-z0-9_]*\s*\)|defined\s+[A-Za-z_][A-Za-z0-9_]*|[A-Za-z_][A-Za-z0-9_]*)\s*$'
        )
        if ($conditionKeywords.Count -gt 1) {
            foreach ($keyword in $conditionKeywords) {
                if (-not $overrideMap.ContainsKey($keyword)) {
                    [void]$issues.Add([pscustomobject][ordered]@{
                        keyword = $keyword
                        candidates = @($conditionKeywords | Where-Object { $_ -ne $keyword })
                        reason = 'Multiple material keywords share one preprocessor condition, so dependency direction is not provable.'
                    })
                }
            }
        }
        [void]$guardStack.Add($(if ($simplePositive) { @($conditionKeywords[0]) } else { @() }))
    }

    $dependencyMap = @{}
    foreach ($keyword in $featureKeywords) {
        if ($overrideMap.ContainsKey($keyword)) {
            $dependencyMap[$keyword] = @($overrideMap[$keyword])
            continue
        }
        $sets = @($occurrences[$keyword] | Where-Object { $null -ne $_ })
        if ($sets.Count -eq 0) {
            $dependencyMap[$keyword] = @()
            [void]$issues.Add([pscustomobject][ordered]@{
                keyword = $keyword
                candidates = @()
                reason = 'No dependency relation can be proven from preprocessor nesting. Confirm this keyword is independent or provide requires.'
            })
            continue
        }
        $intersection = @($sets[0])
        foreach ($set in @($sets | Select-Object -Skip 1)) { $intersection = @($intersection | Where-Object { $set -contains $_ }) }
        $union = @($sets | ForEach-Object { @($_) } | ForEach-Object { $_ } | Select-Object -Unique)
        $uncertain = @($union | Where-Object { $intersection -notcontains $_ })
        if ($uncertain.Count -gt 0) {
            [void]$issues.Add([pscustomobject][ordered]@{
                keyword = $keyword
                candidates = $uncertain
                reason = 'The keyword appears under different parent guards, so no single dependency rule is provable.'
            })
        }
        $dependencyMap[$keyword] = @($intersection)
    }

    foreach ($keyword in @($overrideMap.Keys)) {
        if (-not $featureSet.ContainsKey($keyword)) {
            [void]$issues.Add([pscustomobject][ordered]@{ keyword = $keyword; candidates = @(); reason = 'Dependency override keyword is not a shader_feature keyword.' })
            continue
        }
        foreach ($required in @($overrideMap[$keyword])) {
            if (-not $featureSet.ContainsKey($required)) {
                [void]$issues.Add([pscustomobject][ordered]@{ keyword = $keyword; candidates = @($required); reason = 'Dependency override references an unknown shader_feature keyword.' })
            }
            elseif ($keywordGroup[$keyword] -eq $keywordGroup[$required]) {
                [void]$issues.Add([pscustomobject][ordered]@{ keyword = $keyword; candidates = @($required); reason = 'A keyword cannot require a mutually exclusive keyword from the same pragma group.' })
            }
        }
    }

    foreach ($group in @($FeatureGroups | Where-Object { -not $_.hasOffBaseline })) {
        if (-not $baselineMap.ContainsKey($group.groupId) -or $baselineMap[$group.groupId] -ne 'OFF') {
            [void]$issues.Add([pscustomobject][ordered]@{
                keyword = ''
                candidates = @($group.options)
                groupId = $group.groupId
                reason = 'The shader_feature pragma has no explicit OFF option. Confirm baseline OFF in featureBaselines before a synthetic sweep.'
            })
        }
    }

    $state = @{}
    $cycleKeywords = [Collections.ArrayList]::new()
    function Visit-Dependency {
        param([string]$Keyword)
        if ($state[$Keyword] -eq 1) { [void]$cycleKeywords.Add($Keyword); return }
        if ($state[$Keyword] -eq 2) { return }
        $state[$Keyword] = 1
        foreach ($required in @($dependencyMap[$Keyword] | Where-Object { $null -ne $_ })) { if ($dependencyMap.ContainsKey($required)) { Visit-Dependency $required } }
        $state[$Keyword] = 2
    }
    foreach ($keyword in $featureKeywords) { Visit-Dependency $keyword }
    if ($cycleKeywords.Count -gt 0) {
        [void]$issues.Add([pscustomobject][ordered]@{ keyword = ''; candidates = @($cycleKeywords | Select-Object -Unique); reason = 'Keyword dependency cycle detected.' })
    }

    $dependencies = @($featureKeywords | ForEach-Object {
        [pscustomobject][ordered]@{ keyword = $_; requires = @($dependencyMap[$_]) }
    })
    return [pscustomobject][ordered]@{
        dependencies = $dependencies
        unresolved = @($issues | Sort-Object keyword, groupId, reason -Unique)
    }
}

function Get-DependencyClosure {
    param([string]$Keyword, [hashtable]$DependencyMap)

    $result = [Collections.ArrayList]::new()
    function Add-RequiredKeyword {
        param([string]$Value)
        foreach ($required in @($DependencyMap[$Value] | Where-Object { $null -ne $_ })) {
            Add-RequiredKeyword $required
            if (-not $result.Contains($required)) { [void]$result.Add($required) }
        }
    }
    Add-RequiredKeyword $Keyword
    return @($result)
}

function Resolve-SyntheticCombinations {
    param(
        [Parameter(Mandatory)]$Entries,
        [Parameter(Mandatory)]$Shader,
        [Parameter(Mandatory)][hashtable]$DependencyMap
    )

    $results = [Collections.ArrayList]::new()
    $pairs = @{}
    $entryIndex = 0
    foreach ($entry in @($Entries)) {
        $entryIndex++
        $entryName = "Synthetic combination #$entryIndex"
        if ($entry.PSObject.Properties.Name -contains 'label') { throw "$entryName must not define an artificial label." }
        $baselineInput = @($entry.baselineKeywords | ForEach-Object { [string]$_ })
        $candidateInput = @($entry.candidateKeywords | ForEach-Object { [string]$_ })
        if ($baselineInput.Count -ne @($baselineInput | Select-Object -Unique).Count -or $candidateInput.Count -ne @($candidateInput | Select-Object -Unique).Count) {
            throw "$entryName contains duplicate keywords."
        }
        $unknown = @($baselineInput + $candidateInput | Where-Object { $Shader.materialKeywordOrder -notcontains $_ } | Select-Object -Unique)
        if ($unknown.Count -gt 0) { throw "$entryName references unknown shader_feature keywords: $($unknown -join ', ')." }

        $baseline = @($Shader.materialKeywordOrder | Where-Object { $baselineInput -contains $_ })
        $candidate = @($Shader.materialKeywordOrder | Where-Object { $candidateInput -contains $_ })
        $removed = @($baseline | Where-Object { $candidate -notcontains $_ })
        $added = @($candidate | Where-Object { $baseline -notcontains $_ })
        if ($candidate.Count -eq 0 -or $removed.Count -gt 0 -or $added.Count -lt 2) {
            throw "$entryName candidate must strictly include its baseline and add at least two keywords."
        }

        foreach ($keywordSet in @($baseline, $candidate)) {
            foreach ($group in @($Shader.materialKeywordGroups)) {
                $enabled = @($group.options | Where-Object { $_ -ne '_' -and $keywordSet -contains $_ })
                if ($enabled.Count -gt 1) { throw "$entryName enables mutually exclusive keywords: $($enabled -join ', ')." }
            }
            foreach ($keyword in $keywordSet) {
                $missing = @(Get-DependencyClosure $keyword $DependencyMap | Where-Object { $keywordSet -notcontains $_ })
                if ($missing.Count -gt 0) { throw "$entryName is missing dependencies for '$keyword': $($missing -join ', ')." }
            }
        }

        $pairKey = "$($baseline -join ',')|$($candidate -join ',')"
        if ($pairs.ContainsKey($pairKey)) { throw "$entryName duplicates another baseline and candidate pair." }
        $pairs[$pairKey] = $true
        [void]$results.Add([pscustomobject][ordered]@{
            baselineKeywords = $baseline
            candidateKeywords = $candidate
            addedKeywords = $added
            removedKeywords = $removed
        })
    }
    return @($results)
}

function Expand-MultiCompileCombinations {
    param([Parameter(Mandatory)]$Groups, [Parameter(Mandatory)]$SelectionDocument)

    $selectionMap = @{}
    foreach ($entry in @($SelectionDocument.selections)) {
        if ($entry.groupId) { $selectionMap[[string]$entry.groupId] = @($entry.selected | ForEach-Object { [string]$_ }) }
    }
    $missing = @()
    $invalid = @()
    $combinations = @([pscustomobject]@{ keywords = @(); selections = @() })
    foreach ($group in @($Groups)) {
        if (-not $selectionMap.ContainsKey($group.groupId) -or $selectionMap[$group.groupId].Count -eq 0) {
            $missing += $group
            continue
        }
        $selected = @($selectionMap[$group.groupId] | ForEach-Object { if ($_ -eq 'OFF') { '_' } else { $_ } } | Select-Object -Unique)
        $bad = @($selected | Where-Object { $_ -notin @($group.options) })
        if ($bad.Count -gt 0) {
            $invalid += [pscustomobject][ordered]@{ groupId = $group.groupId; selected = $bad; options = @($group.options) }
            continue
        }
        $next = @()
        foreach ($combination in $combinations) {
            foreach ($option in $selected) {
                $keywords = @($combination.keywords)
                if ($option -ne '_') { $keywords += $option }
                $next += [pscustomobject]@{
                    keywords = @($keywords)
                    selections = @($combination.selections) + [pscustomobject]@{ groupId = $group.groupId; selected = $option }
                }
            }
        }
        $combinations = @($next)
    }
    return [pscustomobject][ordered]@{ combinations = @($combinations); missing = $missing; invalid = $invalid }
}

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw "SelfTest failed: $Message" }
}

function Assert-Throws {
    param([scriptblock]$Action, [string]$Message)
    try {
        & $Action
    }
    catch {
        return
    }
    throw "SelfTest failed: $Message"
}

function Invoke-SelfTest {
    $originalSelectionsPath = $script:SelectionsPath
    $legacySelectionsPath = [IO.Path]::GetTempFileName()
    try {
        [IO.File]::WriteAllText($legacySelectionsPath, '{"selections":[]}', [Text.UTF8Encoding]::new($false))
        $script:SelectionsPath = $legacySelectionsPath
        $legacyDocument = Get-SelectionDocument
        Assert-True (@($legacyDocument.syntheticCombinations).Count -eq 0) 'Missing syntheticCombinations must remain an empty collection.'
    }
    finally {
        $script:SelectionsPath = $originalSelectionsPath
        [IO.File]::Delete($legacySelectionsPath)
    }
    $groups = @(
        [pscustomobject]@{ groupId = 'g1'; options = @('_', 'A') },
        [pscustomobject]@{ groupId = 'g2'; options = @('B', 'C') }
    )
    $document = [pscustomobject]@{
        selections = @(
            [pscustomobject]@{ groupId = 'g1'; selected = @('OFF', 'A') },
            [pscustomobject]@{ groupId = 'g2'; selected = @('B', 'C') }
        )
    }
    $expanded = Expand-MultiCompileCombinations $groups $document
    Assert-True ($expanded.combinations.Count -eq 4) 'Multi compile selections must expand as a Cartesian product.'
    Assert-True (-not (@($expanded.combinations | Where-Object { $_.keywords -contains 'B' -and $_.keywords -contains 'C' }).Count)) 'Mutually exclusive options must not be combined.'
    $map = @{ A = @(); B = @('A'); C = @('B') }
    Assert-True ((@(Get-DependencyClosure 'C' $map) -join ',') -eq 'A,B') 'Dependency closure must be transitive and ordered.'
    $shader = [pscustomobject]@{
        materialKeywordOrder = @('A', 'B', 'C', 'D')
        materialKeywordGroups = @(
            [pscustomobject]@{ options = @('A') },
            [pscustomobject]@{ options = @('B') },
            [pscustomobject]@{ options = @('C', 'D') }
        )
    }
    $combinationMap = @{ A = @(); B = @('A'); C = @('A'); D = @('A') }
    $combination = Resolve-SyntheticCombinations @(
        [pscustomobject]@{ baselineKeywords = @('A'); candidateKeywords = @('A', 'B', 'C') }
    ) $shader $combinationMap
    Assert-True ($combination.Count -eq 1 -and (@($combination[0].addedKeywords) -join ',') -eq 'B,C') 'Synthetic combinations must preserve a strict controlled baseline.'
    Assert-Throws {
        Resolve-SyntheticCombinations @(
            [pscustomobject]@{ label = 'ALL'; baselineKeywords = @('A'); candidateKeywords = @('A', 'B', 'C') }
        ) $shader $combinationMap
    } 'Synthetic combinations must reject artificial labels.'
    Assert-Throws {
        Resolve-SyntheticCombinations @(
            [pscustomobject]@{ baselineKeywords = @(); candidateKeywords = @('B') }
        ) $shader $combinationMap
    } 'Synthetic combinations must reject missing dependencies.'
    Assert-Throws {
        Resolve-SyntheticCombinations @(
            [pscustomobject]@{ baselineKeywords = @('A'); candidateKeywords = @('A', 'C', 'D') }
        ) $shader $combinationMap
    } 'Synthetic combinations must reject mutually exclusive keywords.'
    'SelfTest passed.'
}

function Get-Discovery {
    param([Parameter(Mandatory)]$SelectionDocument)

    $pathLiterals = @($MaterialPath | ForEach-Object { ConvertTo-CSharpString $_ }) -join ', '
    $scopeLiteral = ConvertTo-CSharpString $Scope
    $directoryLiteral = ConvertTo-CSharpString $Directory
    $sceneLiteral = ConvertTo-CSharpString $ScenePath
    $shaderLiteral = ConvertTo-CSharpString $ShaderName
    $passLiteral = ConvertTo-CSharpString $PassName
    $code = @"
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEditor;
using UnityEditor.Rendering;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
Func<string, string> enc = value => Convert.ToBase64String(Encoding.UTF8.GetBytes(value ?? string.Empty));
string scope = $scopeLiteral;
string directory = $directoryLiteral;
string requestedScenePath = $sceneLiteral;
string shaderFilter = $shaderLiteral;
string passName = $passLiteral;
string[] explicitPaths = new string[] { $pathLiterals };
var materials = new List<Material>();
var records = new List<string>();
var shaders = new List<Shader>();
if (scope == "Explicit")
{
    if (explicitPaths.Length == 0) records.Add("D\tDiscovery\tError\t\t\t" + enc("At least one Material path is required."));
    foreach (string path in explicitPaths)
    {
        Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
        if (material == null) records.Add("D\tDiscovery\tError\t\t" + enc(path) + "\t" + enc("Material asset was not found."));
        else materials.Add(material);
    }
}
else if (scope == "Directory")
{
    records.Add("P\t" + enc(directory));
    if (!string.IsNullOrEmpty(directory) && AssetDatabase.IsValidFolder(directory))
    {
        foreach (string guid in AssetDatabase.FindAssets("t:Material", new[] { directory }))
        {
            Material material = AssetDatabase.LoadAssetAtPath<Material>(AssetDatabase.GUIDToAssetPath(guid));
            if (material != null) materials.Add(material);
        }
    }
    else records.Add("D\tDiscovery\tError\t\t" + enc(directory) + "\t" + enc("AssetDatabase directory is missing or invalid."));
}
else if (scope == "Scene")
{
    records.Add("P\t" + enc(requestedScenePath));
    Scene targetScene = default;
    bool openedTemporarily = false;
    try
    {
        if (string.IsNullOrEmpty(requestedScenePath) || AssetDatabase.LoadAssetAtPath<SceneAsset>(requestedScenePath) == null)
        {
            records.Add("D\tDiscovery\tError\t\t" + enc(requestedScenePath) + "\t" + enc("Scene asset was not found."));
        }
        else
        {
            for (int i = 0; i < SceneManager.sceneCount; i++)
            {
                Scene candidate = SceneManager.GetSceneAt(i);
                if (candidate.path == requestedScenePath && candidate.isLoaded) { targetScene = candidate; break; }
            }
            if (!targetScene.IsValid())
            {
                targetScene = EditorSceneManager.OpenScene(requestedScenePath, OpenSceneMode.Additive);
                openedTemporarily = true;
            }
            foreach (GameObject root in targetScene.GetRootGameObjects())
            {
                foreach (Renderer renderer in root.GetComponentsInChildren<Renderer>(true))
                {
                    materials.AddRange(renderer.sharedMaterials.Where(material => material != null));
                }
            }
        }
    }
    finally
    {
        if (openedTemporarily && targetScene.IsValid()) EditorSceneManager.CloseScene(targetScene, true);
    }
}
else
{
    if (string.IsNullOrEmpty(shaderFilter))
    {
        records.Add("D\tDiscovery\tError\t\t\t" + enc("ShaderName is required for Synthetic scope."));
    }
    else
    {
        var candidates = AssetDatabase.FindAssets("t:Shader")
            .Select(AssetDatabase.GUIDToAssetPath)
            .Select(path => AssetDatabase.LoadAssetAtPath<Shader>(path))
            .Where(shader => shader != null)
            .ToArray();
        Shader[] exact = candidates.Where(shader => shader.name == shaderFilter).ToArray();
        Shader[] suffix = candidates.Where(shader => shader.name.Split('/').Last() == shaderFilter).ToArray();
        Shader[] matches = exact.Length > 0 ? exact : suffix;
        if (matches.Length == 1) shaders.Add(matches[0]);
        else if (matches.Length == 0) records.Add("D\tDiscovery\tError\t\t\t" + enc("Shader was not found: " + shaderFilter));
        else records.Add("D\tDiscovery\tError\t\t\t" + enc("Shader name is ambiguous: " + string.Join(", ", matches.Select(shader => shader.name).Distinct().OrderBy(value => value))));
    }
}
var collected = materials
    .Where(material => material != null && material.shader != null)
    .Select(material => new { Material = material, Path = AssetDatabase.GetAssetPath(material) })
    .Where(item => !string.IsNullOrEmpty(item.Path))
    .GroupBy(item => item.Path)
    .Select(group => group.First())
    .ToArray();
if (!string.IsNullOrEmpty(shaderFilter) && scope != "Synthetic")
{
    var exact = collected.Where(item => item.Material.shader.name == shaderFilter).ToArray();
    var suffix = collected.Where(item => item.Material.shader.name.Split('/').Last() == shaderFilter).ToArray();
    collected = exact.Length > 0 ? exact : suffix;
    string[] names = collected.Select(item => item.Material.shader.name).Distinct().ToArray();
    if (names.Length > 1)
    {
        records.Add("D\tDiscovery\tError\t\t\t" + enc("Shader name is ambiguous in the selected source: " + string.Join(", ", names.OrderBy(value => value))));
        collected = collected.Take(0).ToArray();
    }
}
foreach (var item in collected.OrderBy(item => item.Path))
{
    string shaderPath = AssetDatabase.GetAssetPath(item.Material.shader);
    string shaderGuid = AssetDatabase.AssetPathToGUID(shaderPath);
    string keywords = string.Join(",", item.Material.enabledKeywords.Select(keyword => keyword.name));
    records.Add("M\t" + enc(item.Path) + "\t" + enc(item.Material.name) + "\t" + enc(item.Material.shader.name) + "\t" + enc(shaderGuid) + "\t" + enc(keywords));
    shaders.Add(item.Material.shader);
}
foreach (Shader shader in shaders.Distinct().OrderBy(value => value.name))
{
    string shaderPath = AssetDatabase.GetAssetPath(shader);
    string shaderGuid = AssetDatabase.AssetPathToGUID(shaderPath);
    ShaderData data = ShaderUtil.GetShaderData(shader);
    if ($SubShader < 0 || $SubShader >= data.SubshaderCount)
    {
        records.Add("D\tDiscovery\tError\t" + enc(shader.name) + "\t\t" + enc("SubShader index is out of range."));
        continue;
    }
    ShaderData.Subshader subshader = data.GetSubshader($SubShader);
    ShaderData.Pass targetPass = null;
    int passIndex = -1;
    for (int i = 0; i < subshader.PassCount; i++)
    {
        ShaderData.Pass candidate = subshader.GetPass(i);
        if (candidate.Name == passName) { targetPass = candidate; passIndex = i; break; }
    }
    if (targetPass == null)
    {
        records.Add("D\tDiscovery\tError\t" + enc(shader.name) + "\t\t" + enc("Pass was not found: " + passName));
        continue;
    }
    records.Add("S\t" + enc(shader.name) + "\t" + enc(shaderGuid) + "\t" + enc(shaderPath) + "\t" + passIndex + "\t" + enc(targetPass.SourceCode));
}
records.Add("R\t" + enc(Application.unityVersion));
return string.Join("\n", records);
"@

    $result = Invoke-UnityCode $code
    $materials = @()
    $shaderRecords = @()
    $diagnostics = @()
    $unityVersion = ''
    $sourcePaths = if ($Scope -eq 'Explicit') { @($MaterialPath) } else { @() }
    foreach ($line in $result -split "`n") {
        if (-not $line) { continue }
        $parts = $line.TrimEnd("`r") -split "`t"
        switch ($parts[0]) {
            'M' {
                $materials += [pscustomobject][ordered]@{
                    materialPath = ConvertFrom-Base64Text $parts[1]
                    materialName = ConvertFrom-Base64Text $parts[2]
                    shader = ConvertFrom-Base64Text $parts[3]
                    shaderGuid = ConvertFrom-Base64Text $parts[4]
                    enabledKeywords = @((ConvertFrom-Base64Text $parts[5]) -split ',' | Where-Object { $_ })
                    collectionSource = $Scope
                }
            }
            'S' {
                $shader = ConvertFrom-Base64Text $parts[1]
                $shaderGuid = ConvertFrom-Base64Text $parts[2]
                $shaderPath = ConvertFrom-Base64Text $parts[3]
                $source = ConvertFrom-Base64Text $parts[5]
                $multiGroups = @(Get-PragmaGroups $source $shaderGuid 'multi_compile')
                $featureGroups = @(Get-PragmaGroups $source $shaderGuid 'shader_feature')
                $dependencyAnalysis = Get-DependencyAnalysis $source $featureGroups $SelectionDocument
                $shaderRecords += [pscustomobject][ordered]@{
                    shader = $shader
                    shaderGuid = $shaderGuid
                    shaderPath = $shaderPath
                    subShader = $SubShader
                    pass = $PassName
                    passIndex = [int]$parts[4]
                    multiCompileGroups = $multiGroups
                    materialKeywordGroups = $featureGroups
                    multiCompileKeywordOrder = @(Get-KeywordOrder $multiGroups)
                    materialKeywordOrder = @(Get-KeywordOrder $featureGroups)
                    keywordDependencies = @($dependencyAnalysis.dependencies)
                    unresolvedKeywordDependencies = @($dependencyAnalysis.unresolved)
                }
                if ($Scope -eq 'Synthetic') { $sourcePaths += $shaderPath }
            }
            'D' {
                $diagnostics += [pscustomobject][ordered]@{
                    materialPath = if ($parts[4]) { ConvertFrom-Base64Text $parts[4] } else { '' }
                    shader = if ($parts[3]) { ConvertFrom-Base64Text $parts[3] } else { '' }
                    variantId = ''
                    phase = $parts[1]
                    severity = $parts[2]
                    message = ConvertFrom-Base64Text $parts[5]
                }
            }
            'P' { $sourcePaths += ConvertFrom-Base64Text $parts[1] }
            'R' { $unityVersion = ConvertFrom-Base64Text $parts[1] }
        }
    }

    $errors = @($diagnostics | Where-Object severity -eq 'Error')
    $unresolved = @($shaderRecords | ForEach-Object { $_.unresolvedKeywordDependencies })
    $missingSelections = @()
    $invalidSelections = @()
    foreach ($shaderRecord in $shaderRecords) {
        $expanded = Expand-MultiCompileCombinations $shaderRecord.multiCompileGroups $SelectionDocument
        $combinationCount = if ($expanded.missing.Count -gt 0 -or $expanded.invalid.Count -gt 0) { 0 } else { @($expanded.combinations).Count }
        $shaderRecord | Add-Member -NotePropertyName multiCompileCombinationCount -NotePropertyValue $combinationCount -Force
        $missingSelections += @($expanded.missing)
        $invalidSelections += @($expanded.invalid)
    }
    $status = if ($errors.Count -gt 0) {
        'DiscoveryFailed'
    }
    elseif ($Scope -ne 'Synthetic' -and $materials.Count -eq 0) {
        'NoMaterials'
    }
    elseif ($shaderRecords.Count -eq 0) {
        'NoShaders'
    }
    elseif ($Scope -eq 'Synthetic' -and $unresolved.Count -gt 0) {
        'NeedsKeywordDependencyConfirmation'
    }
    elseif ($missingSelections.Count -gt 0 -or $invalidSelections.Count -gt 0) {
        'NeedsMultiCompileSelection'
    }
    else {
        'Ready'
    }

    return [pscustomobject][ordered]@{
        schemaVersion = 4
        status = $status
        run = [pscustomobject][ordered]@{
            runTime = [DateTimeOffset]::Now.ToString('o')
            scope = $Scope
            sourceType = if ($Scope -eq 'Synthetic') { 'Synthetic Keyword Sweep' } else { $Scope }
            sourcePaths = @($sourcePaths | Where-Object { $_ } | Select-Object -Unique)
            shaderFilter = $ShaderName
            buildTarget = $BuildTarget
            compilerPlatform = $CompilerPlatform
            maliCore = $MaliCore
            subShader = $SubShader
            pass = $PassName
            unityVersion = $unityVersion
        }
        materials = @($materials)
        shaders = @($shaderRecords)
        diagnostics = @($diagnostics)
        missingMultiCompileGroups = @($missingSelections)
        invalidMultiCompileSelections = @($invalidSelections)
    }
}

function Get-VariantId {
    param([string]$ShaderGuid, [string[]]$MaterialKeywords, [string[]]$MultiKeywords)

    $key = @(
        $ShaderGuid,
        $SubShader,
        $PassName,
        (@($MaterialKeywords | Sort-Object) -join ','),
        (@($MultiKeywords | Sort-Object) -join ','),
        $BuildTarget,
        $CompilerPlatform,
        $MaliCore
    ) -join '|'
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $hash = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($key))
        return ([BitConverter]::ToString($hash).Replace('-', '').ToLowerInvariant()).Substring(0, 16)
    }
    finally { $sha.Dispose() }
}

function Invoke-UnityCompile {
    param([Parameter(Mandatory)]$Variant)

    $shaderPathLiteral = ConvertTo-CSharpString $Variant.shaderPath
    $passLiteral = ConvertTo-CSharpString $PassName
    $targetLiteral = ConvertTo-CSharpString $BuildTarget
    $platformLiteral = ConvertTo-CSharpString $CompilerPlatform
    $keywordLiterals = @($Variant.effectiveKeywords | ForEach-Object { ConvertTo-CSharpString $_ }) -join ', '
    $code = @"
using System;
using System.Linq;
using System.Text;
using UnityEditor;
using UnityEditor.Rendering;
using UnityEngine;
Shader shader = AssetDatabase.LoadAssetAtPath<Shader>($shaderPathLiteral);
if (shader == null) return "E\t" + Convert.ToBase64String(Encoding.UTF8.GetBytes("Shader was not found."));
Material temporaryMaterial = new Material(shader);
try
{
    ShaderData data = ShaderUtil.GetShaderData(shader);
    if ($SubShader < 0 || $SubShader >= data.SubshaderCount) return "E\t" + Convert.ToBase64String(Encoding.UTF8.GetBytes("SubShader index is out of range."));
    ShaderData.Subshader subshader = data.GetSubshader($SubShader);
    ShaderData.Pass targetPass = null;
    for (int i = 0; i < subshader.PassCount; i++)
    {
        ShaderData.Pass candidate = subshader.GetPass(i);
        if (candidate.Name == $passLiteral) { targetPass = candidate; break; }
    }
    if (targetPass == null) return "E\t" + Convert.ToBase64String(Encoding.UTF8.GetBytes("Pass was not found."));
    string[] keywords = new[] { $keywordLiterals };
    BuildTarget target = (BuildTarget)Enum.Parse(typeof(BuildTarget), $targetLiteral);
    ShaderCompilerPlatform platform = (ShaderCompilerPlatform)Enum.Parse(typeof(ShaderCompilerPlatform), $platformLiteral);
    ShaderData.VariantCompileInfo result = targetPass.CompileVariant(ShaderType.Vertex, keywords, platform, target);
    string messages = string.Join("\n", result.Messages.Select(message => message.severity + ": " + message.message));
    return "C\t" + result.Success + "\t" + Convert.ToBase64String(result.ShaderData) + "\t" + Convert.ToBase64String(Encoding.UTF8.GetBytes(messages));
}
finally
{
    UnityEngine.Object.DestroyImmediate(temporaryMaterial);
}
"@

    $result = Invoke-UnityCode $code
    $parts = $result -split "`t"
    if ($parts[0] -eq 'E') { return [pscustomobject]@{ success = $false; shaderData = @(); messages = ConvertFrom-Base64Text $parts[1] } }
    return [pscustomobject]@{
        success = [bool]::Parse($parts[1])
        shaderData = [Convert]::FromBase64String($parts[2])
        messages = ConvertFrom-Base64Text $parts[3]
    }
}

function Get-MaliRows {
    param($Report, $Variant, [string]$Stage, [int]$VariantOrder)

    $rows = @()
    $shader = $Report.shaders[0]
    foreach ($maliVariant in @($shader.variants)) {
        $rows += [pscustomobject][ordered]@{
            variantId = $Variant.variantId
            variantOrder = $VariantOrder
            shader = $Variant.shader
            pass = $PassName
            materialCount = $Variant.materialPaths.Count
            materialKeywords = @($Variant.materialKeywords) -join ' '
            multiCompileKeywords = @($Variant.multiKeywords) -join ' '
            stage = $Stage
            maliVariant = $maliVariant.name
            malioc = [pscustomobject][ordered]@{
                driver = $shader.driver
                filename = $shader.filename
                hardware = $shader.hardware
                notes = @($shader.notes)
                properties = @($shader.properties)
                shader = $shader.shader
                warnings = @($shader.warnings)
                variant = $maliVariant
            }
            compileStatus = 'Success'
        }
    }
    return @($rows)
}

function Invoke-MaliReport {
    param([string]$Source, [ValidateSet('Vertex', 'Fragment')][string]$Stage)

    $stageFlag = if ($Stage -eq 'Vertex') { '--vertex' } else { '--fragment' }
    $raw = $Source | & malioc $stageFlag --opengles --core $MaliCore --format json --detailed -
    $report = ($raw -join [Environment]::NewLine) | ConvertFrom-Json
    return [pscustomobject]@{ exitCode = $LASTEXITCODE; report = $report }
}

if ($SelfTest) {
    Invoke-SelfTest
    exit 0
}

$prerequisites = Get-Prerequisites
if ($Mode -eq 'Preflight') {
    $prerequisites | ConvertTo-Json -Depth 5
    exit 0
}

$selectionDocument = Get-SelectionDocument
$discovery = Get-Discovery $selectionDocument
$dependencyMap = @{}
$syntheticCombinations = @()
if ($Scope -ne 'Synthetic' -and @($selectionDocument.syntheticCombinations).Count -gt 0) {
    throw 'syntheticCombinations is only valid for Synthetic scope.'
}
if ($Scope -eq 'Synthetic' -and $discovery.shaders.Count -eq 1 -and $discovery.shaders[0].unresolvedKeywordDependencies.Count -eq 0) {
    foreach ($dependency in @($discovery.shaders[0].keywordDependencies)) { $dependencyMap[$dependency.keyword] = @($dependency.requires) }
    $syntheticCombinations = @(Resolve-SyntheticCombinations $selectionDocument.syntheticCombinations $discovery.shaders[0] $dependencyMap)
    $discovery.shaders[0] | Add-Member -NotePropertyName syntheticCombinationCount -NotePropertyValue $syntheticCombinations.Count -Force
}
if ($Mode -eq 'Discover') {
    Write-JsonFile $discovery
    $discovery | ConvertTo-Json -Depth 30
    exit 0
}

if ($CompilerPlatform -ne 'GLES3x') { throw 'Only ShaderCompilerPlatform.GLES3x is supported by this skill.' }
if ($discovery.shaders.Count -ne 1) {
    Write-JsonFile $discovery
    throw 'Analyze requires exactly one resolved Shader. Create one report per Shader.'
}
if ($Scope -ne 'Synthetic' -and $discovery.materials.Count -eq 0) {
    Write-JsonFile $discovery
    throw 'No materials were discovered.'
}
if ($Scope -eq 'Synthetic' -and $discovery.shaders[0].unresolvedKeywordDependencies.Count -gt 0) {
    $discovery.status = 'NeedsKeywordDependencyConfirmation'
    Write-JsonFile $discovery
    throw 'Keyword dependencies or feature baselines cannot be inferred reliably. Confirm them in the selections JSON.'
}
$shader = $discovery.shaders[0]
$expanded = Expand-MultiCompileCombinations $shader.multiCompileGroups $selectionDocument
if ($expanded.missing.Count -gt 0 -or $expanded.invalid.Count -gt 0) {
    $discovery.status = 'NeedsMultiCompileSelection'
    $discovery | Add-Member -NotePropertyName missingMultiCompileGroups -NotePropertyValue @($expanded.missing) -Force
    $discovery | Add-Member -NotePropertyName invalidMultiCompileSelections -NotePropertyValue @($expanded.invalid) -Force
    Write-JsonFile $discovery
    throw 'Every multi_compile group requires one or more valid explicit selections.'
}

$variants = @{}
function Add-Variant {
    param([string[]]$MaterialKeywords, [string[]]$MultiKeywords, [string]$MaterialAssetPath = '')

    $material = @($shader.materialKeywordOrder | Where-Object { $MaterialKeywords -contains $_ })
    $material += @($MaterialKeywords | Where-Object { $material -notcontains $_ } | Select-Object -Unique)
    $multi = @($shader.multiCompileKeywordOrder | Where-Object { $MultiKeywords -contains $_ })
    $id = Get-VariantId $shader.shaderGuid $material $multi
    if (-not $variants.ContainsKey($id)) {
        $variants[$id] = [pscustomobject][ordered]@{
            variantId = $id
            shader = $shader.shader
            shaderGuid = $shader.shaderGuid
            shaderPath = $shader.shaderPath
            representativePath = if ($Scope -eq 'Synthetic') { 'In-memory temporary material, not saved' } else { $MaterialAssetPath }
            materialKeywords = $material
            multiKeywords = $multi
            materialSortKey = Get-KeywordSortKey $material $shader.materialKeywordOrder
            multiSortKey = Get-KeywordSortKey $multi $shader.multiCompileKeywordOrder
            effectiveKeywords = @($material + $multi | Sort-Object -Unique)
            materialPaths = [Collections.ArrayList]::new()
        }
    }
    if ($MaterialAssetPath -and -not $variants[$id].materialPaths.Contains($MaterialAssetPath)) {
        [void]$variants[$id].materialPaths.Add($MaterialAssetPath)
        if (-not $variants[$id].representativePath) { $variants[$id].representativePath = $MaterialAssetPath }
    }
    return $id
}

$comparisons = [Collections.ArrayList]::new()
if ($Scope -eq 'Synthetic') {
    foreach ($combination in @($expanded.combinations)) {
        foreach ($keyword in @($shader.materialKeywordOrder)) {
            $closure = @(Get-DependencyClosure $keyword $dependencyMap)
            $baselineKeywords = @($shader.materialKeywordOrder | Where-Object { $closure -contains $_ })
            $candidateKeywords = @($shader.materialKeywordOrder | Where-Object { @($closure + $keyword) -contains $_ })
            $baselineId = Add-Variant $baselineKeywords @($combination.keywords)
            $candidateId = Add-Variant $candidateKeywords @($combination.keywords)
            [void]$comparisons.Add([pscustomobject][ordered]@{
                baselineVariantId = $baselineId
                candidateVariantId = $candidateId
                dependencyChain = $closure
                baselineKeywords = $baselineKeywords
                candidateKeywords = $candidateKeywords
                addedKeywords = @($keyword)
                removedKeywords = @()
                multiCompileContext = @($combination.keywords)
                comparisonType = 'SyntheticKeywordSweep'
            })
        }
        foreach ($syntheticCombination in $syntheticCombinations) {
            $baselineId = Add-Variant $syntheticCombination.baselineKeywords @($combination.keywords)
            $candidateId = Add-Variant $syntheticCombination.candidateKeywords @($combination.keywords)
            [void]$comparisons.Add([pscustomobject][ordered]@{
                baselineVariantId = $baselineId
                candidateVariantId = $candidateId
                dependencyChain = @($syntheticCombination.baselineKeywords)
                baselineKeywords = @($syntheticCombination.baselineKeywords)
                candidateKeywords = @($syntheticCombination.candidateKeywords)
                addedKeywords = @($syntheticCombination.addedKeywords)
                removedKeywords = @($syntheticCombination.removedKeywords)
                multiCompileContext = @($combination.keywords)
                comparisonType = 'SyntheticKeywordCombination'
            })
        }
    }
}
else {
    $multiKeywordSet = @($shader.multiCompileKeywordOrder)
    foreach ($material in @($discovery.materials | Where-Object shaderGuid -eq $shader.shaderGuid)) {
        $materialKeywords = @($material.enabledKeywords | Where-Object { $multiKeywordSet -notcontains $_ })
        foreach ($combination in @($expanded.combinations)) { [void](Add-Variant $materialKeywords @($combination.keywords) $material.materialPath) }
    }
    $values = @($variants.Values)
    for ($leftIndex = 0; $leftIndex -lt $values.Count; $leftIndex++) {
        for ($rightIndex = 0; $rightIndex -lt $values.Count; $rightIndex++) {
            if ($leftIndex -eq $rightIndex) { continue }
            $baseline = $values[$leftIndex]
            $candidate = $values[$rightIndex]
            if ((@($baseline.multiKeywords) -join "`0") -ne (@($candidate.multiKeywords) -join "`0")) { continue }
            $added = @($candidate.materialKeywords | Where-Object { $baseline.materialKeywords -notcontains $_ })
            $removed = @($baseline.materialKeywords | Where-Object { $candidate.materialKeywords -notcontains $_ })
            if ($added.Count -ne 1 -or $removed.Count -ne 0) { continue }
            if (@($comparisons | Where-Object { $_.baselineVariantId -eq $baseline.variantId -and $_.candidateVariantId -eq $candidate.variantId }).Count -gt 0) { continue }
            [void]$comparisons.Add([pscustomobject][ordered]@{
                baselineVariantId = $baseline.variantId
                candidateVariantId = $candidate.variantId
                dependencyChain = @()
                baselineKeywords = @($baseline.materialKeywords)
                candidateKeywords = @($candidate.materialKeywords)
                addedKeywords = $added
                removedKeywords = $removed
                multiCompileContext = @($candidate.multiKeywords)
                comparisonType = 'ObservedExactDifference'
            })
        }
    }
}

$diagnostics = [Collections.ArrayList]::new()
foreach ($diagnostic in @($discovery.diagnostics)) { [void]$diagnostics.Add($diagnostic) }
$variantSummaries = [Collections.ArrayList]::new()
$variantRows = [Collections.ArrayList]::new()
$maliMetadata = $null
$variantOrder = 0
$orderedVariants = @($variants.Values | Sort-Object multiSortKey, materialSortKey, variantId)
foreach ($variant in $orderedVariants) {
    $summary = [pscustomobject][ordered]@{
        variantId = $variant.variantId
        variantOrder = $variantOrder
        shader = $variant.shader
        pass = $PassName
        materialCount = $variant.materialPaths.Count
        materialKeywords = @($variant.materialKeywords) -join ' '
        multiCompileKeywords = @($variant.multiKeywords) -join ' '
        representativeMaterialPath = $variant.representativePath
        compileStatus = 'Pending'
    }
    try {
        $compiled = Invoke-UnityCompile $variant
        if ($compiled.messages) {
            [void]$diagnostics.Add([pscustomobject][ordered]@{
                materialPath = $variant.representativePath
                shader = $variant.shader
                variantId = $variant.variantId
                phase = 'UnityCompile'
                severity = if ($compiled.success) { 'Warning' } else { 'Error' }
                message = $compiled.messages
            })
        }
        if (-not $compiled.success -or $compiled.shaderData.Count -eq 0) { throw 'Unity did not produce GLES3 shader data.' }
        $glsl = [Text.Encoding]::UTF8.GetString($compiled.shaderData)
        $split = [regex]::Match($glsl, '(?s)^#ifdef VERTEX\r?\n(?<vs>.*)\r?\n#endif\r?\n#ifdef FRAGMENT\r?\n(?<ps>.*)\r?\n#endif\s*$')
        if (-not $split.Success) { throw 'Unity GLES3 shader data did not contain the expected VERTEX and FRAGMENT wrappers.' }
        foreach ($stage in @('Vertex', 'Fragment')) {
            $source = if ($stage -eq 'Vertex') { $split.Groups['vs'].Value } else { $split.Groups['ps'].Value }
            $mali = Invoke-MaliReport $source $stage
            if ($mali.exitCode -ne 0 -or $mali.report.schema.name -ne 'performance') {
                $errors = @($mali.report.shaders[0].errors) -join [Environment]::NewLine
                throw "MaliOC $stage failed: $errors"
            }
            if ($null -eq $maliMetadata) { $maliMetadata = [pscustomobject][ordered]@{ producer = $mali.report.producer; schema = $mali.report.schema } }
            $maliShader = $mali.report.shaders[0]
            foreach ($warning in @($maliShader.warnings)) {
                [void]$diagnostics.Add([pscustomobject][ordered]@{ materialPath = $variant.representativePath; shader = $variant.shader; variantId = $variant.variantId; phase = "MaliOC $stage"; severity = 'Warning'; message = if ($warning -is [string]) { $warning } else { $warning | ConvertTo-Json -Depth 10 -Compress } })
            }
            foreach ($note in @($maliShader.notes)) {
                [void]$diagnostics.Add([pscustomobject][ordered]@{ materialPath = $variant.representativePath; shader = $variant.shader; variantId = $variant.variantId; phase = "MaliOC $stage"; severity = 'Info'; message = if ($note -is [string]) { $note } else { $note | ConvertTo-Json -Depth 10 -Compress } })
            }
            foreach ($row in @(Get-MaliRows $mali.report $variant $stage $variantOrder)) { [void]$variantRows.Add($row) }
        }
        $summary.compileStatus = 'Success'
    }
    catch {
        $summary.compileStatus = 'Failed'
        [void]$diagnostics.Add([pscustomobject][ordered]@{ materialPath = $variant.representativePath; shader = $variant.shader; variantId = $variant.variantId; phase = 'Analysis'; severity = 'Error'; message = $_.Exception.Message })
    }
    [void]$variantSummaries.Add($summary)
    $variantOrder++
}

$maliVersion = (& malioc --version | Select-Object -First 1)
$analysis = [pscustomobject][ordered]@{
    schemaVersion = 4
    status = if (@($diagnostics | Where-Object severity -eq 'Error').Count -gt 0) { 'CompletedWithErrors' } else { 'Completed' }
    run = [pscustomobject][ordered]@{
        runTime = [DateTimeOffset]::Now.ToString('o')
        scope = $Scope
        sourceType = $discovery.run.sourceType
        sourcePaths = @($discovery.run.sourcePaths)
        shader = $shader.shader
        shaderPath = $shader.shaderPath
        shaderFilter = $ShaderName
        buildTarget = $BuildTarget
        compilerPlatform = $CompilerPlatform
        maliCore = $MaliCore
        subShader = $SubShader
        pass = $PassName
        multiCompileCombinationCount = @($expanded.combinations).Count
        syntheticCombinationCount = $syntheticCombinations.Count
        multiCompileKeywordOrder = @($shader.multiCompileKeywordOrder)
        materialKeywordOrder = @($shader.materialKeywordOrder)
        materialCount = if ($Scope -eq 'Synthetic') { 0 } else { $discovery.materials.Count }
        variantCount = $variants.Count
        comparisonCount = $comparisons.Count
        unityVersion = $discovery.run.unityVersion
        maliocVersion = $maliVersion
        malioc = $maliMetadata
    }
    keywordDependencies = @($shader.keywordDependencies)
    variantSummaries = @($variantSummaries)
    variants = @($variantRows)
    comparisons = @($comparisons)
    diagnostics = @($diagnostics)
}

Write-JsonFile $analysis
$analysis | ConvertTo-Json -Depth 30
