using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.ComponentModel;
using System.ComponentModel.Composition;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Input;
using System.Windows.Media;
using MLAstro_Robotic_Polar_Alignment.Plugin;
using MLAstro_Robotic_Polar_Alignment.Services;
 
namespace MLAstro_Robotic_Polar_Alignment
{
    [Export(typeof(ResourceDictionary))]
    public partial class Options : ResourceDictionary
    {
        public Options()
        {
            InitializeComponent();
        }

        private void OnScrollViewerPreviewMouseWheel(object sender, MouseWheelEventArgs e)
        {
            if (FindAncestor<RichTextBox>(e.OriginalSource as DependencyObject) != null)
            {
                return;
            }

            var scrollViewer = FindOutermostAncestor<ScrollViewer>(e.OriginalSource as DependencyObject)
                ?? sender as ScrollViewer;
            if (scrollViewer == null)
            {
                return;
            }

            scrollViewer.ScrollToVerticalOffset(scrollViewer.VerticalOffset - (e.Delta / 3d));
            e.Handled = true;
        }

        private void OnOptionsScrollViewerLoaded(object sender, RoutedEventArgs e)
        {
            if (sender is not ScrollViewer scrollViewer)
            {
                return;
            }

            scrollViewer.RemoveHandler(UIElement.PreviewMouseWheelEvent, new MouseWheelEventHandler(OnScrollViewerPreviewMouseWheel));
            scrollViewer.AddHandler(UIElement.PreviewMouseWheelEvent, new MouseWheelEventHandler(OnScrollViewerPreviewMouseWheel), true);
            RegisterPanelMouseWheelHandlers(scrollViewer.Content as DependencyObject);
        }

        private void OnSerialTerminalInputPreviewKeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key != Key.Enter)
            {
                return;
            }

            if (sender is TextBox textBox && textBox.DataContext is MLAstroManifest manifest)
            {
                manifest.SendSerialCommand.Execute(null);
                e.Handled = true;
            }
        }

        private void OnSerialTerminalInputTextChanged(object sender, TextChangedEventArgs e)
        {
            if (sender is not TextBox textBox || textBox.DataContext is not MLAstroManifest manifest || !manifest.IsHexInputEnabled)
            {
                return;
            }

            var sanitizedText = new string((textBox.Text ?? string.Empty)
                .Where(Uri.IsHexDigit)
                .Take(16)
                .ToArray())
                .ToUpperInvariant();

            if (sanitizedText == textBox.Text)
            {
                return;
            }

            var caretIndex = Math.Min(textBox.CaretIndex, sanitizedText.Length);
            textBox.Text = sanitizedText;
            textBox.CaretIndex = caretIndex;
        }

        private void OnSerialTerminalLoaded(object sender, RoutedEventArgs e)
        {
            if (sender is not RichTextBox richTextBox || richTextBox.Tag is TerminalSubscriptionState)
            {
                return;
            }

            if (richTextBox.DataContext is not MLAstroManifest manifest)
            {
                return;
            }

            var state = new TerminalSubscriptionState();
            state.Document = CreateTerminalDocument();

            state.TerminalScrollViewer = FindDescendant<ScrollViewer>(richTextBox);
            state.ShouldAutoScroll = true;
            richTextBox.Document = state.Document;

            state.EntryPropertyChangedHandler = (entrySender, _) =>
            {
                if (entrySender is SerialTerminalEntry entry)
                {
                    UpdateTerminalEntry(richTextBox, state, entry);
                }
            };
            state.CollectionChangedHandler = (_, args) =>
            {
                if (args.OldItems != null)
                {
                    foreach (SerialTerminalEntry entry in args.OldItems)
                    {
                        entry.PropertyChanged -= state.EntryPropertyChangedHandler;
                    }
                }

                if (args.NewItems != null)
                {
                    foreach (SerialTerminalEntry entry in args.NewItems)
                    {
                        entry.PropertyChanged += state.EntryPropertyChangedHandler;
                    }
                }

                ApplyTerminalCollectionChanged(richTextBox, state, manifest.SerialTerminalEntries, args);
            };

            state.ScrollChangedHandler = (_, _) =>
            {
                if (state.IsUpdatingScroll || state.TerminalScrollViewer == null)
                {
                    return;
                }

                state.LastVerticalOffset = state.TerminalScrollViewer.VerticalOffset;
                state.ShouldAutoScroll = IsAtBottom(state.TerminalScrollViewer);
            };

            foreach (var entry in manifest.SerialTerminalEntries)
            {
                entry.PropertyChanged += state.EntryPropertyChangedHandler;
            }

            manifest.SerialTerminalEntries.CollectionChanged += state.CollectionChangedHandler;
            if (state.TerminalScrollViewer != null)
            {
                state.TerminalScrollViewer.ScrollChanged += state.ScrollChangedHandler;
            }

            richTextBox.RemoveHandler(UIElement.PreviewMouseWheelEvent, new MouseWheelEventHandler(OnSerialTerminalPreviewMouseWheel));
            richTextBox.AddHandler(UIElement.PreviewMouseWheelEvent, new MouseWheelEventHandler(OnSerialTerminalPreviewMouseWheel), true);
            richTextBox.Tag = state;

            RebuildTerminalDocument(richTextBox, state, manifest.SerialTerminalEntries);
        }

        private void OnSerialTerminalPreviewMouseWheel(object sender, MouseWheelEventArgs e)
        {
            if (sender is not RichTextBox richTextBox)
            {
                return;
            }

            var scrollViewer = FindDescendant<ScrollViewer>(richTextBox);
            if (scrollViewer == null)
            {
                return;
            }

            scrollViewer.ScrollToVerticalOffset(scrollViewer.VerticalOffset - (e.Delta / 3d));
            e.Handled = true;
        }

        private void OnSerialTerminalCopyClick(object sender, RoutedEventArgs e)
        {
            if (sender is MenuItem menuItem && menuItem.Parent is ContextMenu contextMenu && contextMenu.PlacementTarget is RichTextBox richTextBox)
            {
                richTextBox.Copy();
            }
        }

        private static FlowDocument CreateTerminalDocument()
        {
            return new FlowDocument
            {
                PagePadding = new Thickness(0),
                TextAlignment = TextAlignment.Left
            };
        }

        private static void RebuildTerminalDocument(RichTextBox richTextBox, TerminalSubscriptionState state, IEnumerable<SerialTerminalEntry> entries)
        {
            UpdateTerminalView(richTextBox, state, () =>
            {
                state.Document.Blocks.Clear();
                state.EntryParagraphs.Clear();
                state.OrderedEntries.Clear();

                foreach (var entry in entries)
                {
                    InsertTerminalEntry(state, entry, state.OrderedEntries.Count);
                }
            });
        }

        private static void ApplyTerminalCollectionChanged(RichTextBox richTextBox, TerminalSubscriptionState state, IEnumerable<SerialTerminalEntry> entries, NotifyCollectionChangedEventArgs args)
        {
            if (args == null)
            {
                return;
            }

            if (args.Action == NotifyCollectionChangedAction.Reset)
            {
                RebuildTerminalDocument(richTextBox, state, entries);
                return;
            }

            UpdateTerminalView(richTextBox, state, () =>
            {
                if (args.OldItems != null)
                {
                    foreach (SerialTerminalEntry entry in args.OldItems)
                    {
                        RemoveTerminalEntry(state, entry);
                    }
                }

                if (args.NewItems != null)
                {
                    var insertIndex = args.NewStartingIndex < 0 ? state.OrderedEntries.Count : args.NewStartingIndex;
                    foreach (SerialTerminalEntry entry in args.NewItems)
                    {
                        InsertTerminalEntry(state, entry, insertIndex++);
                    }
                }
            });
        }

        private static void UpdateTerminalEntry(RichTextBox richTextBox, TerminalSubscriptionState state, SerialTerminalEntry entry)
        {
            if (entry == null || state == null)
            {
                return;
            }

            UpdateTerminalView(richTextBox, state, () =>
            {
                if (!state.EntryParagraphs.TryGetValue(entry, out var paragraph))
                {
                    return;
                }

                paragraph.Inlines.Clear();
                paragraph.Inlines.Add(new Run(entry.DisplayText));
                paragraph.Margin = new Thickness(0);
                paragraph.Foreground = entry.Foreground;
            });
        }

        private static void UpdateTerminalView(RichTextBox richTextBox, TerminalSubscriptionState state, Action updateAction)
        {
            if (richTextBox == null || state == null || updateAction == null)
            {
                return;
            }

            var scrollViewer = state.TerminalScrollViewer ?? FindDescendant<ScrollViewer>(richTextBox);
            var shouldAutoScroll = state.ShouldAutoScroll;
            var previousVerticalOffset = scrollViewer?.VerticalOffset ?? state.LastVerticalOffset;

            state.IsUpdatingScroll = true;
            try
            {
                updateAction();
                richTextBox.UpdateLayout();

                scrollViewer = state.TerminalScrollViewer ?? FindDescendant<ScrollViewer>(richTextBox);
                if (scrollViewer == null)
                {
                    if (shouldAutoScroll)
                    {
                        richTextBox.ScrollToEnd();
                    }

                    return;
                }

                state.TerminalScrollViewer = scrollViewer;

                if (shouldAutoScroll)
                {
                    richTextBox.ScrollToEnd();
                }
                else
                {
                    scrollViewer.ScrollToVerticalOffset(previousVerticalOffset);
                }
            }
            finally
            {
                if (state.TerminalScrollViewer != null)
                {
                    state.LastVerticalOffset = state.TerminalScrollViewer.VerticalOffset;
                    state.ShouldAutoScroll = IsAtBottom(state.TerminalScrollViewer);
                }

                state.IsUpdatingScroll = false;
            }
        }

        private static void InsertTerminalEntry(TerminalSubscriptionState state, SerialTerminalEntry entry, int index)
        {
            if (state == null || entry == null)
            {
                return;
            }

            var paragraph = new Paragraph(new Run(entry.DisplayText))
            {
                Margin = new Thickness(0),
                Foreground = entry.Foreground
            };

            if (index < 0 || index >= state.OrderedEntries.Count)
            {
                state.Document.Blocks.Add(paragraph);
                state.OrderedEntries.Add(entry);
                state.EntryParagraphs[entry] = paragraph;
                return;
            }

            var nextEntry = state.OrderedEntries[index];
            if (state.EntryParagraphs.TryGetValue(nextEntry, out var nextParagraph))
            {
                state.Document.Blocks.InsertBefore(nextParagraph, paragraph);
            }
            else
            {
                state.Document.Blocks.Add(paragraph);
            }

            state.OrderedEntries.Insert(index, entry);
            state.EntryParagraphs[entry] = paragraph;
        }

        private static void RemoveTerminalEntry(TerminalSubscriptionState state, SerialTerminalEntry entry)
        {
            if (state == null || entry == null)
            {
                return;
            }

            if (state.EntryParagraphs.TryGetValue(entry, out var paragraph))
            {
                state.Document.Blocks.Remove(paragraph);
                state.EntryParagraphs.Remove(entry);
            }

            state.OrderedEntries.Remove(entry);
        }

        private static bool IsAtBottom(ScrollViewer scrollViewer)
        {
            if (scrollViewer == null)
            {
                return true;
            }

            return scrollViewer.VerticalOffset + scrollViewer.ViewportHeight >= scrollViewer.ExtentHeight - 1;
        }

        private static T FindDescendant<T>(DependencyObject parent) where T : DependencyObject
        {
            if (parent == null)
            {
                return null;
            }

            for (var i = 0; i < VisualTreeHelper.GetChildrenCount(parent); i++)
            {
                var child = VisualTreeHelper.GetChild(parent, i);
                if (child is T typedChild)
                {
                    return typedChild;
                }

                var result = FindDescendant<T>(child);
                if (result != null)
                {
                    return result;
                }
            }

            return null;
        }

        private static T FindAncestor<T>(DependencyObject child) where T : DependencyObject
        {
            while (child != null)
            {
                if (child is T typedChild)
                {
                    return typedChild;
                }

                child = GetParentObject(child);
            }

            return null;
        }

        private static T FindOutermostAncestor<T>(DependencyObject child) where T : DependencyObject
        {
            T result = null;

            while (child != null)
            {
                if (child is T typedChild)
                {
                    result = typedChild;
                }

                child = GetParentObject(child);
            }

            return result;
        }

        private void RegisterPanelMouseWheelHandlers(DependencyObject parent)
        {
            if (parent == null || parent is RichTextBox)
            {
                return;
            }

            if (parent is UIElement uiElement)
            {
                uiElement.RemoveHandler(UIElement.PreviewMouseWheelEvent, new MouseWheelEventHandler(OnScrollViewerPreviewMouseWheel));
                uiElement.AddHandler(UIElement.PreviewMouseWheelEvent, new MouseWheelEventHandler(OnScrollViewerPreviewMouseWheel), true);
            }

            if (parent is not Visual and not System.Windows.Media.Media3D.Visual3D)
            {
                return;
            }

            for (var i = 0; i < VisualTreeHelper.GetChildrenCount(parent); i++)
            {
                RegisterPanelMouseWheelHandlers(VisualTreeHelper.GetChild(parent, i));
            }
        }

        private static DependencyObject GetParentObject(DependencyObject child)
        {
            if (child == null)
            {
                return null;
            }

            if (child is Visual || child is System.Windows.Media.Media3D.Visual3D)
            {
                return VisualTreeHelper.GetParent(child);
            }

            if (child is FrameworkContentElement frameworkContentElement)
            {
                return frameworkContentElement.Parent ?? ContentOperations.GetParent(frameworkContentElement);
            }

            if (child is FrameworkElement frameworkElement)
            {
                return frameworkElement.Parent;
            }

            return LogicalTreeHelper.GetParent(child);
        }

        private sealed class TerminalSubscriptionState
        {
            public NotifyCollectionChangedEventHandler CollectionChangedHandler { get; set; }

            public PropertyChangedEventHandler EntryPropertyChangedHandler { get; set; }

            public ScrollChangedEventHandler ScrollChangedHandler { get; set; }

            public ScrollViewer TerminalScrollViewer { get; set; }

            public FlowDocument Document { get; set; }

            public Dictionary<SerialTerminalEntry, Paragraph> EntryParagraphs { get; } = new();

            public List<SerialTerminalEntry> OrderedEntries { get; } = new();

            public bool ShouldAutoScroll { get; set; }

            public bool IsUpdatingScroll { get; set; }

            public double LastVerticalOffset { get; set; }
        }
    }
}
