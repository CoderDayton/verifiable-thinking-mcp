# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

We take the security of `verifiable-thinking-mcp` seriously. If you discover a security vulnerability, please report it responsibly.

### How to Report

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please report security issues by emailing the maintainer directly or using GitHub's private vulnerability reporting feature:

1. Go to the [Security tab](https://github.com/CoderDayton/verifiable-thinking-mcp/security)
2. Click "Report a vulnerability"
3. Fill out the form with details about the vulnerability

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if you have one)

### Response Timeline

- **Initial response**: Within 48 hours
- **Status update**: Within 7 days
- **Fix timeline**: Depends on severity (critical: ASAP, high: 14 days, medium: 30 days)

### Scope

This security policy covers:

- The `verifiable-thinking-mcp` npm package
- Code in this repository
- Dependencies directly used by this package

### Out of Scope

- Vulnerabilities in user applications that use this package incorrectly
- Social engineering attacks
- Issues in third-party services

## Security Best Practices for Users

When using this MCP server:

1. **Keep dependencies updated**: Run `npm audit` or `bun audit` regularly
2. **Review session data**: Session data is stored in memory; restart the server to clear
3. **Validate inputs**: The package validates inputs via Zod, but always sanitize user-facing inputs in your application
4. **Use environment variables**: Never hardcode sensitive configuration

## Acknowledgments

We appreciate security researchers who help keep this project safe. Contributors who responsibly disclose vulnerabilities will be acknowledged (with permission) in our release notes.
