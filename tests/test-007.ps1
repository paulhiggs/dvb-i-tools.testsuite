# Tests for Playlist responses

[string[]]$test_files = @()
Get-ChildItem -Path "$PSScriptRoot\..\input\test-007" -Filter *.xml | 
	Foreach-Object {	
		$test_files += $_.FullName
	}

node $PSScriptRoot\..\test-runner.js --mode pl --nomarkup --src $test_files $args