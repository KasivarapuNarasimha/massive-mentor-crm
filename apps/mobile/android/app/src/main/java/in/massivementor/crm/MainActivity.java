package in.massivementor.crm;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

/**
 * Android entry — loads hosted CRM via Capacitor server.url.
 *
 * Back button: navigate WebView history when possible; otherwise background the
 * app instead of finishing (avoids accidental exit during CRM navigation).
 * Works even before the CRM web bridge is deployed to production.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getOnBackPressedDispatcher().addCallback(
            this,
            new OnBackPressedCallback(true) {
                @Override
                public void handleOnBackPressed() {
                    WebView webView =
                        getBridge() != null ? getBridge().getWebView() : null;
                    if (webView != null && webView.canGoBack()) {
                        webView.goBack();
                        return;
                    }
                    // Root of CRM stack — do not force-close
                    moveTaskToBack(true);
                }
            }
        );
    }
}
