# run all regression cases

[string[]]$test_files = @()
Get-ChildItem -Path "$PSScriptRoot\..\input\test-002" -Filter *.xml | 
	Foreach-Object {
		$test_files += "[sl]" + $_.FullName
	}
	
Get-ChildItem -Path "$PSScriptRoot\..\input\test-003" -Recurse -Filter *.xml | 
	Foreach-Object {
		$test_files += "[sl]" + $_.FullName
	}

Get-ChildItem -Path "$PSScriptRoot\..\input\test-004" -Filter *.xml | 
	Foreach-Object {	
		$test_files += "[cg-ProgInfo]" + $_.FullName 
	}

Get-ChildItem -Path "$PSScriptRoot\..\input\test-005" -Filter *.xml | 
	Foreach-Object {	
		$test_files += "[slr]" + $_.FullName 
	}

Get-ChildItem -Path "$PSScriptRoot\..\input\test-006\SLR" -Filter *.xml | 
	Foreach-Object {	
		$test_files += "[slr]" + $_.FullName 
	}

Get-ChildItem -Path "$PSScriptRoot\..\input\test-006\SL" -Filter *.xml | 
	Foreach-Object {	
		$test_files += "[sl]" + $_.FullName 
	}

Get-ChildItem -Path "$PSScriptRoot\..\input\test-007" -Filter *.xml | 
	Foreach-Object {	
		$test_files += "[pl]" + $_.FullName 
	}

Get-ChildItem -Path "$PSScriptRoot\..\input\test-008" -Filter *.xml | 
	Foreach-Object {	
		$test_files += "[cg-NowNext]" + $_.FullName 
	}
	
Get-ChildItem -Path "$PSScriptRoot\..\input\test-009" -Filter *.xml | 
	Foreach-Object {	
		$test_files += "[cg-bsCategories]" + $_.FullName 
	}

Get-ChildItem -Path "$PSScriptRoot\..\input\test-010" -Filter *.xml | 
	Foreach-Object {	
		$test_files += "[cg-bsLists]" + $_.FullName 
	}
	
Get-ChildItem -Path "$PSScriptRoot\..\input\test-012" -Filter *.xml | 
	Foreach-Object {	
		$test_files += "[cg-MoreEpisodes]" + $_.FullName 
	}
	
$TempFile = New-TemporaryFile
$test_files | Out-File -Append -Encoding "UTF8" -FilePath $TempFile.FullName
	
node $PSScriptRoot\..\test-runner.js --mode individual --nomarkup --src $TempFile.FullName $args

Remove-Item $TempFile.FullName -Force