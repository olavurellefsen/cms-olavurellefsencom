namespace OlavurEllefsen.Umbraco.Sync;

public sealed class ProjectionWriteGuard
{
    private readonly AsyncLocal<int> suppressionDepth = new();

    public bool IsSuppressed => suppressionDepth.Value > 0;

    public IDisposable Suppress()
    {
        suppressionDepth.Value++;
        return new Scope(this);
    }

    private sealed class Scope(ProjectionWriteGuard owner) : IDisposable
    {
        private bool disposed;

        public void Dispose()
        {
            if (disposed) return;
            disposed = true;
            owner.suppressionDepth.Value = Math.Max(0, owner.suppressionDepth.Value - 1);
        }
    }
}
