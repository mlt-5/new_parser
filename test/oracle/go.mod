module bard/new_parser/oracle

go 1.26.0

require (
	bard/new_parser/go v0.0.0
	github.com/autobrr/rls v0.10.0
)

require (
	golang.org/x/sync v0.24.0 // indirect
	golang.org/x/text v0.43.0 // indirect
)

replace github.com/autobrr/rls => ../../rls

replace bard/new_parser/go => ../../go
