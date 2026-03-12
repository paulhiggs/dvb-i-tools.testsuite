# Tests for Service List Registry responses

[string[]]$test_files = @()
Get-ChildItem -Path "$PSScriptRoot\..\input\test-005" -Filter *.xml | 
	Foreach-Object {	
		$test_files += $_.FullName
	}

node $PSScriptRoot\..\test-runner.js --mode slr --nomarkup --src $test_files