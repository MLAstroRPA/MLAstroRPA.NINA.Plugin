using System;
using System.ComponentModel;

namespace MLAstro_Robotic_Polar_Alignment.Dockables
{
    public sealed class MockTppaVm : INotifyPropertyChanged
    {
        private readonly Random _random = new Random();
        private MockPolarErrorDetermination _polarErrorDetermination;

        public event PropertyChangedEventHandler PropertyChanged;

        public MockTppaVm()
        {
            _polarErrorDetermination = new MockPolarErrorDetermination(0.75, -1.10);
        }

        public MockPolarErrorDetermination PolarErrorDetermination
        {
            get => _polarErrorDetermination;
            private set
            {
                _polarErrorDetermination = value;
                PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(PolarErrorDetermination)));
            }
        }

        public void Step()
        {
            var alt = Math.Round((_random.NextDouble() * 4d) - 2d, 2);
            var az = Math.Round((_random.NextDouble() * 4d) - 2d, 2);
            PolarErrorDetermination.SetValues(alt, az);
        }
    }

    public sealed class MockPolarErrorDetermination : INotifyPropertyChanged
    {
        public event PropertyChangedEventHandler PropertyChanged;

        public MockPolarErrorDetermination(double altitudeDegrees, double azimuthDegrees)
        {
            CurrentMountAxisAltitudeError = new MockAngle(altitudeDegrees);
            CurrentMountAxisAzimuthError = new MockAngle(azimuthDegrees);
        }

        public MockAngle CurrentMountAxisAltitudeError { get; private set; }

        public MockAngle CurrentMountAxisAzimuthError { get; private set; }

        public void SetValues(double altitudeDegrees, double azimuthDegrees)
        {
            CurrentMountAxisAltitudeError = new MockAngle(altitudeDegrees);
            CurrentMountAxisAzimuthError = new MockAngle(azimuthDegrees);
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(CurrentMountAxisAltitudeError)));
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(CurrentMountAxisAzimuthError)));
        }
    }

    public sealed class MockAngle
    {
        public MockAngle(double degree)
        {
            Degree = degree;
        }

        public double Degree { get; }
    }
}
