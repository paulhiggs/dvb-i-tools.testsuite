# Tests for Examples in the A177 specification

[string[]]$test_files = @()
Get-ChildItem -Path "$PSScriptRoot\..\input\test-006\SLR" -Filter *.xml | 
	Foreach-Object {	
		$test_files += $_.FullName
	}

node $PSScriptRoot\..\test-runner.js --mode slr --nomarkup --src $test_files $args