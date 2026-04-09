# Tests for Detailed Program Information responses

[string[]]$test_files = @()
Get-ChildItem -Path "$PSScriptRoot\..\input\test-004" -Filter *.xml | 
	Foreach-Object {	
		$test_files += $_.FullName
	}

node $PSScriptRoot\..\test-runner.ts --mode cg-ProgInfo --nomarkup --src $test_files