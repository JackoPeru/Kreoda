#if NETSTANDARD2_1
using System.Threading;
using System.Threading.Tasks;

namespace Kreoda.Session;

internal static class TaskCompatibility
{
    internal static async Task WaitAsync(this Task task, CancellationToken cancellationToken)
    {
        if (task.IsCompleted || !cancellationToken.CanBeCanceled)
        {
            await task.ConfigureAwait(false);
            return;
        }

        cancellationToken.ThrowIfCancellationRequested();
        using var linkedCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        try
        {
            var cancelled = Task.Delay(Timeout.Infinite, linkedCancellation.Token);
            if (await Task.WhenAny(task, cancelled).ConfigureAwait(false) != task)
                cancellationToken.ThrowIfCancellationRequested();

            await task.ConfigureAwait(false);
        }
        finally
        {
            linkedCancellation.Cancel();
        }
    }
}
#endif
