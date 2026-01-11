# Contributing to verifiable-thinking-mcp

Thank you for your interest in contributing! This document provides guidelines and instructions for contributing.

## Development Setup

### Prerequisites

- [Bun](https://bun.sh) >= 1.0
- Node.js >= 18 (for compatibility testing)
- Git

### Getting Started

```bash
# Clone the repository
git clone https://github.com/CoderDayton/verifiable-thinking-mcp.git
cd verifiable-thinking-mcp

# Install dependencies
bun install

# Run tests
bun test

# Start development server
bun run dev
```

## Code Quality Standards

### Before Submitting

All contributions must pass these checks:

```bash
# Type checking (zero errors required)
bun run typecheck

# Linting
bun run lint

# Tests (all must pass)
bun test

# Coverage (>85% required)
bun run test:coverage
```

### Code Style

- We use [Biome](https://biomejs.dev) for linting and formatting
- Run `bun run format` to auto-format code
- Follow existing patterns in the codebase

### Architecture Principles

1. **No duplication**: Extract shared logic into `src/lib/`
2. **Type safety**: No `any` without explicit justification
3. **O(n) complexity**: Keep trap detection and routing fast
4. **Test coverage**: New features require tests

## Pull Request Process

### 1. Create an Issue First

For non-trivial changes, open an issue to discuss before starting work. This prevents wasted effort.

### 2. Branch Naming

```
feat/short-description    # New features
fix/issue-number          # Bug fixes
docs/what-changed         # Documentation
refactor/what-changed     # Code refactoring
```

### 3. Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new trap pattern for anchoring bias
fix: correct verification threshold calculation
docs: update installation instructions
test: add edge cases for compression
refactor: simplify session management
```

### 4. PR Checklist

- [ ] Tests pass locally (`bun test`)
- [ ] Type check passes (`bun run typecheck`)
- [ ] Lint passes (`bun run lint`)
- [ ] Coverage maintained (>85%)
- [ ] CHANGELOG.md updated (for user-facing changes)
- [ ] Documentation updated (if applicable)

### 5. Review Process

- PRs require one approval before merging
- Address review feedback or explain why not
- Keep PRs focused—one feature/fix per PR

## Types of Contributions

### Bug Reports

Open an issue with:
- Clear title describing the bug
- Steps to reproduce
- Expected vs actual behavior
- Environment details (Bun version, OS)

### Feature Requests

Open an issue with:
- Clear description of the feature
- Use case / motivation
- Proposed implementation (optional)

### Adding Trap Patterns

Trap patterns are in `src/lib/traps/`. To add a new pattern:

1. Add pattern to `src/lib/traps/patterns.ts`
2. Add detection logic
3. Add test cases in `test/traps/`
4. Update README if significant

### Documentation

- README.md for user-facing docs
- Code comments for complex logic
- JSDoc for public APIs

## Testing Guidelines

### Test Structure

```typescript
import { describe, test, expect } from "bun:test";

describe("featureName", () => {
  test("should do expected behavior", () => {
    // Arrange
    const input = "...";
    
    // Act
    const result = functionUnderTest(input);
    
    // Assert
    expect(result).toBe(expected);
  });
});
```

### Test Naming

- Describe what the test verifies
- Use "should" format: `"should return empty array for invalid input"`

### Coverage Requirements

- New code should have >85% coverage
- Critical paths (trap detection, verification) should have >95%

## Getting Help

- Open a [Discussion](https://github.com/CoderDayton/verifiable-thinking-mcp/discussions) for questions
- Check existing issues before opening new ones
- Tag issues appropriately (`bug`, `enhancement`, `question`)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
