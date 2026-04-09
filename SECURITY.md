# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | Yes       |

## Reporting an Issue

**Please do not report sensitive issues through public GitHub issues.**

Instead, please use **GitHub Security Advisories**:

1. Go to the [Security tab](https://github.com/isaiasgv/linearr/security/advisories)
2. Click **Report a vulnerability**
3. Provide a description, steps to reproduce, and potential impact

### Response timeline

- **Acknowledgment**: Within 48 hours
- **Assessment**: Within 7 days
- **Resolution**: Typically within 30 days depending on complexity

## Deployment Best Practices

- Use a strong, unique `APP_SECRET` value
- Place Linearr behind a reverse proxy with HTTPS
- Keep `.env` out of version control
- Update Docker images regularly
