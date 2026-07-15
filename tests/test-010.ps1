# Tests for Playlist responses

[string[]]$test_files = @()
Get-ChildItem -Path "$PSScriptRoot\..\input\test-010" -Filter *.xml | 
	Foreach-Object {	
		$test_files += $_.FullName
	}

node $PSScriptRoot\..\test-runner.js --mode cg-bsLists --nomarkup --src $test_files $args