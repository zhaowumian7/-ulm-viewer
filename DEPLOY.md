# Deploy to GitHub Pages

This folder is a standalone static site for GitHub Pages.

## Push to a GitHub repository

Create an empty GitHub repository, then run:

```powershell
.\deploy.ps1 -RepoUrl "https://github.com/<user>/<repo>.git"
```

Or use SSH:

```powershell
.\deploy.ps1 -RepoUrl "git@github.com:<user>/<repo>.git"
```

## Enable GitHub Pages

After pushing:

1. Open the GitHub repository.
2. Go to `Settings` > `Pages`.
3. Set `Build and deployment` source to `Deploy from a branch`.
4. Choose branch `main` and folder `/ (root)`.
5. Save.

The site URL will usually be:

```text
https://<user>.github.io/<repo>/
```

