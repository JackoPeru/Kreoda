using System.Runtime.CompilerServices;

// Unity compiles Editor tests separately from Runtime; expose internal guards to tests only.
[assembly: InternalsVisibleTo("Kreoda.QuestRuntime.Tests")]
