using NINA.Core.Utility;
using System.Windows.Controls;
using System.Windows.Input;

namespace MLAstro_Robotic_Polar_Alignment.Dockables
{
    public partial class PolarAlignmentDockable : UserControl
    {
        public PolarAlignmentDockable()
        {
            Logger.Info("[MLAstro] PolarAlignmentDockable view created");
            InitializeComponent();
        }

        #region Movement Event Handlers

        private void OnMoveUpDown(object sender, MouseButtonEventArgs e)
        {
            (DataContext as PolarAlignmentDockVM)?.StartMoveUp();
        }

        private void OnMoveUpUp(object sender, MouseEventArgs e)
        {
            (DataContext as PolarAlignmentDockVM)?.StopAllMovement();
        }

        private void OnMoveDownDown(object sender, MouseButtonEventArgs e)
        {
            (DataContext as PolarAlignmentDockVM)?.StartMoveDown();
        }

        private void OnMoveDownUp(object sender, MouseEventArgs e)
        {
            (DataContext as PolarAlignmentDockVM)?.StopAllMovement();
        }

        private void OnMoveLeftDown(object sender, MouseButtonEventArgs e)
        {
            (DataContext as PolarAlignmentDockVM)?.StartMoveLeft();
        }

        private void OnMoveLeftUp(object sender, MouseEventArgs e)
        {
            (DataContext as PolarAlignmentDockVM)?.StopAllMovement();
        }

        private void OnMoveRightDown(object sender, MouseButtonEventArgs e)
        {
            (DataContext as PolarAlignmentDockVM)?.StartMoveRight();
        }

        private void OnMoveRightUp(object sender, MouseEventArgs e)
        {
            (DataContext as PolarAlignmentDockVM)?.StopAllMovement();
        }

        #endregion

        #region Relative Settings Event Handlers

        // Degrees
        private void OnRelativeDegreesIncDown(object sender, MouseButtonEventArgs e)
        {
            var vm = DataContext as PolarAlignmentDockVM;
            if (vm != null)
            {
                vm.StartEditingRelative();
                vm.RelativeDegrees++;
            }
        }

        private void OnRelativeDegreesDecDown(object sender, MouseButtonEventArgs e)
        {
            var vm = DataContext as PolarAlignmentDockVM;
            if (vm != null)
            {
                vm.StartEditingRelative();
                vm.RelativeDegrees--;
            }
        }

        private void OnRelativeDegreesButtonUp(object sender, MouseButtonEventArgs e)
        {
            (DataContext as PolarAlignmentDockVM)?.SendRelativeDegrees();
        }

        // Minutes
        private void OnRelativeMinutesIncDown(object sender, MouseButtonEventArgs e)
        {
            var vm = DataContext as PolarAlignmentDockVM;
            if (vm != null)
            {
                vm.StartEditingRelative();
                vm.RelativeMinutes += 5;
            }
        }

        private void OnRelativeMinutesDecDown(object sender, MouseButtonEventArgs e)
        {
            var vm = DataContext as PolarAlignmentDockVM;
            if (vm != null)
            {
                vm.StartEditingRelative();
                vm.RelativeMinutes -= 5;
            }
        }

        private void OnRelativeMinutesButtonUp(object sender, MouseButtonEventArgs e)
        {
            (DataContext as PolarAlignmentDockVM)?.SendRelativeMinutes();
        }

        // Seconds
        private void OnRelativeSecondsIncDown(object sender, MouseButtonEventArgs e)
        {
            var vm = DataContext as PolarAlignmentDockVM;
            if (vm != null)
            {
                vm.StartEditingRelative();
                vm.RelativeSeconds += 5;
            }
        }

        private void OnRelativeSecondsDecDown(object sender, MouseButtonEventArgs e)
        {
            var vm = DataContext as PolarAlignmentDockVM;
            if (vm != null)
            {
                vm.StartEditingRelative();
                vm.RelativeSeconds -= 5;
            }
        }

        private void OnRelativeSecondsButtonUp(object sender, MouseButtonEventArgs e)
        {
            (DataContext as PolarAlignmentDockVM)?.SendRelativeSeconds();
        }

        #endregion
    }
}
