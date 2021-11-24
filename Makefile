
.PHONY: all
all: clean build

ANTORA_CLI ?= node_modules/.bin/antora

.PHONY: clean
clean:
	rm -Rf build


.PHONY: build
build:
	$(ANTORA_CLI) --fetch antora-playbook.yaml


.PHONY: local
local:
	$(ANTORA_CLI) --fetch local-antora-playbook.yaml --log-level info


.PHONY: version
version:
	@$(ANTORA_CLI) -v
